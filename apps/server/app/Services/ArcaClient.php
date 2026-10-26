<?php

namespace App\Services;

use App\Models\FiscalSetting;
use App\Support\AppError;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Http;
use SimpleXMLElement;

/** Adaptación de la autenticación de gestion-silvia, sin credenciales compartidas ni TLS debilitado. */
class ArcaClient
{
    private const URLS = [
        'homologacion' => ['wsaa' => 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', 'wsfe' => 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx'],
        'produccion' => ['wsaa' => 'https://wsaa.afip.gov.ar/ws/services/LoginCms', 'wsfe' => 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'],
    ];

    public function call(FiscalSetting $setting, string $method, string $body = ''): SimpleXMLElement
    {
        $ticket = $this->ticket($setting);
        $auth = '<Auth><Token>'.self::escape($ticket['token']).'</Token><Sign>'.self::escape($ticket['sign']).'</Sign><Cuit>'.$setting->cuit.'</Cuit></Auth>';
        $xml = $this->post(self::URLS[$setting->environment]['wsfe'], $method, $auth.$body, 'http://ar.gov.afip.dif.FEV1/');
        $result = $xml->xpath('//*[local-name()="'.$method.'Result"]')[0] ?? null;
        if ($result === null) {
            throw AppError::badRequest('ARCA_RESPONSE', 'ARCA devolvió una respuesta incompleta');
        }

        return $result;
    }

    public function check(FiscalSetting $setting): array
    {
        $result = $this->call($setting, 'FEParamGetPtosVenta');
        self::assertNoErrors($result);
        $points = [];
        foreach ($result->xpath('.//*[local-name()="PtoVenta"]') as $point) {
            $points[] = ['number' => (int) self::value($point, 'Nro'), 'type' => self::value($point, 'EmisionTipo'), 'blocked' => self::value($point, 'Bloqueado'), 'closedOn' => self::value($point, 'FchBaja')];
        }

        return ['environment' => $setting->environment, 'pointsOfSale' => $points];
    }

    public function ticket(FiscalSetting $setting): array
    {
        return Cache::lock('arca-ticket-'.$setting->id, 90)->block(5, function () use ($setting) {
            $setting->refresh();
            if ($setting->ticket_enc && $setting->ticket_expires_at?->isAfter(now()->addMinutes(10))) {
                return json_decode(Crypt::decryptString($setting->ticket_enc), true, 512, JSON_THROW_ON_ERROR);
            }
            if (! $setting->certificate_enc || ! $setting->private_key_enc) {
                throw AppError::badRequest('ARCA_CERTIFICATE_MISSING', 'Cargá el certificado y su clave privada para este ambiente');
            }
            $certificate = Crypt::decryptString($setting->certificate_enc);
            $key = Crypt::decryptString($setting->private_key_enc);
            $info = openssl_x509_parse($certificate);
            if (! $info || ($info['validTo_time_t'] ?? 0) <= time()) {
                throw AppError::badRequest('ARCA_CERTIFICATE_EXPIRED', 'El certificado está vencido o es inválido');
            }
            $tra = '<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>'.time().'</uniqueId><generationTime>'.gmdate('c', time() - 600).'</generationTime><expirationTime>'.gmdate('c', time() + 600).'</expirationTime></header><service>wsfe</service></loginTicketRequest>';
            $input = tempnam(sys_get_temp_dir(), 'gc-tra-');
            $output = tempnam(sys_get_temp_dir(), 'gc-cms-');
            try {
                file_put_contents($input, $tra);
                if (! openssl_pkcs7_sign($input, $output, $certificate, [$key, ''], [], PKCS7_BINARY)) {
                    throw AppError::badRequest('ARCA_SIGNATURE', 'No se pudo firmar el pedido. Revisá el certificado y la clave privada.');
                }
                $parts = preg_split('/\r?\n\r?\n/', file_get_contents($output), 2);
                $cms = preg_replace('/\s+/', '', $parts[1] ?? '');
            } finally {
                @unlink($input);
                @unlink($output);
            }
            $xml = $this->post(self::URLS[$setting->environment]['wsaa'], 'loginCms', '<in0>'.$cms.'</in0>', 'http://wsaa.view.sua.dvadac.desein.afip.gov');
            $ta = self::xml(self::value($xml, 'loginCmsReturn'));
            $token = self::value($ta, 'token');
            $sign = self::value($ta, 'sign');
            $expires = self::value($ta, 'expirationTime');
            if (! $token || ! $sign || ! $expires) {
                throw AppError::badRequest('ARCA_TICKET', 'ARCA no devolvió un ticket de acceso válido');
            }
            $credentials = ['token' => $token, 'sign' => $sign];
            $setting->forceFill(['ticket_enc' => Crypt::encryptString(json_encode($credentials)), 'ticket_expires_at' => Carbon::parse($expires)->utc()])->save();

            return $credentials;
        });
    }

    private function post(string $url, string $method, string $body, string $namespace): SimpleXMLElement
    {
        $envelope = '<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><'.$method.' xmlns="'.$namespace.'">'.$body.'</'.$method.'></soap:Body></soap:Envelope>';
        try {
            $response = Http::timeout(40)->connectTimeout(10)->withHeaders(['SOAPAction' => $method === 'loginCms' ? '""' : '"'.$namespace.$method.'"'])->withBody($envelope, 'text/xml; charset=utf-8')->post($url);
        } catch (ConnectionException) {
            throw AppError::badRequest('ARCA_CONNECTION', 'No se pudo conectar con ARCA. Si estabas emitiendo, consultá o reintentá el mismo comprobante; no generes otra venta.');
        }
        // Nunca se incorporan las credenciales de la solicitud a los errores o al registro.
        $xml = self::xml($response->body());
        $fault = self::value($xml, 'faultstring');
        if ($fault) {
            throw AppError::badRequest('ARCA_FAULT', 'ARCA: '.mb_substr($fault, 0, 500));
        }
        if (! $response->successful()) {
            throw AppError::badRequest('ARCA_HTTP', 'ARCA respondió con un error de servicio');
        }

        return $xml;
    }

    public static function xml(string $raw): SimpleXMLElement
    {
        if (preg_match('/<!DOCTYPE|<!ENTITY/i', $raw)) {
            throw AppError::badRequest('ARCA_XML', 'ARCA devolvió una respuesta XML inválida');
        }
        $previous = libxml_use_internal_errors(true);
        try {
            $xml = simplexml_load_string($raw, SimpleXMLElement::class, LIBXML_NONET);
            if ($xml === false) {
                throw AppError::badRequest('ARCA_XML', 'No se pudo interpretar la respuesta de ARCA');
            }

            return $xml;
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
    }

    public static function value(SimpleXMLElement $xml, string $name): string
    {
        return (string) ($xml->xpath('.//*[local-name()="'.$name.'"]')[0] ?? '');
    }

    public static function assertNoErrors(SimpleXMLElement $xml): void
    {
        $errors = $xml->xpath('.//*[local-name()="Errors"]/*[local-name()="Err"]');
        if ($errors) {
            $messages = array_map(fn ($e) => self::value($e, 'Code').': '.self::value($e, 'Msg'), $errors);
            throw AppError::badRequest('ARCA_REJECTED', mb_substr(implode(' · ', $messages), 0, 1000));
        }
    }

    public static function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_XML1 | ENT_QUOTES, 'UTF-8');
    }
}
