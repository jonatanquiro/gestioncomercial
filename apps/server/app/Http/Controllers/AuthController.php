<?php

namespace App\Http\Controllers;

use App\Auth\Client;
use App\Auth\Cookies;
use App\Services\AuthService;
use App\Support\Catalog;
use App\Support\Input;
use App\Support\Tokens;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/** Mismas reglas que registerTenantSchema, loginSchema, etc. de packages/contracts/src/schemas.ts. */
class AuthController extends Controller
{
    public function __construct(private readonly AuthService $auth) {}

    public function businessTypes(): JsonResponse
    {
        return $this->json($this->auth->businessTypes());
    }

    public function register(Request $request): JsonResponse
    {
        $data = $this->body($request);
        $data['email'] = Input::email($data['email'] ?? null);
        $input = Input::validate($data, [
            'tradeName' => ['required', 'string', 'max:120'],
            'legalName' => ['nullable', 'string', 'max:160'],
            'cuit' => ['nullable', 'string', Input::cuitRule()],
            'taxCondition' => ['required', 'string', Rule::in(Catalog::taxConditions())],
            'businessTypeCode' => ['required', 'string', 'max:40'],
            'ownerName' => ['required', 'string', 'max:120'],
            'email' => ['required', 'string', 'email', 'max:254'],
            'password' => Input::passwordRules(),
        ], Input::passwordMessages('password'));
        $input['legalName'] = $input['legalName'] ?? null;
        $input['cuit'] = Input::optionalCuit($input['cuit'] ?? null);

        $session = $this->auth->register($input, Client::from($request));

        return $this->withNewSession($this->json(['ok' => true], 201), $session['token']);
    }

    public function login(Request $request): JsonResponse
    {
        $data = $this->body($request);
        $data['login'] = Input::email($data['login'] ?? null);
        $input = Input::validate($data, [
            'login' => ['required', 'string', 'max:254'],
            'password' => ['required', 'string', 'max:128'],
        ]);
        $session = $this->auth->login($input['login'], $input['password'], Client::from($request));

        return $this->withNewSession($this->json(['ok' => true]), $session['token']);
    }

    public function forgotPassword(Request $request): JsonResponse
    {
        $data = $this->body($request);
        $data['email'] = Input::email($data['email'] ?? null);
        $input = Input::validate($data, ['email' => ['required', 'string', 'email', 'max:254']]);
        $this->auth->forgotPassword($input['email'], Client::from($request));

        return $this->json(['ok' => true, 'message' => 'Si el email está registrado, te enviamos un enlace para restablecer la contraseña.'], 202);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $input = Input::validate($this->body($request), [
            'token' => ['required', 'string', 'min:20', 'max:200'],
            'password' => Input::passwordRules(),
        ], Input::passwordMessages('password'));
        $this->auth->resetPassword($input['token'], $input['password'], Client::from($request));

        return $this->json(['ok' => true]);
    }

    public function logout(Request $request): JsonResponse
    {
        $this->auth->logout($this->actor($request));

        return $this->json(['ok' => true])->withCookie(Cookies::forget(Cookies::SESSION));
    }

    public function me(Request $request): JsonResponse
    {
        [$csrf, $cookie] = Cookies::ensureCsrf($request);
        $response = $this->json($this->auth->me($this->actor($request)) + ['csrfToken' => $csrf]);

        return $cookie ? $response->withCookie($cookie) : $response;
    }

    public function switchTenant(Request $request): JsonResponse
    {
        $input = Input::validate($this->body($request), ['tenantId' => ['required', 'string', 'uuid']]);
        $this->auth->switchTenant($this->actor($request), $input['tenantId']);

        return $this->json(['ok' => true]);
    }

    public function changePassword(Request $request): JsonResponse
    {
        $input = Input::validate($this->body($request), [
            'currentPassword' => ['required', 'string', 'max:128'],
            'newPassword' => Input::passwordRules(),
        ], Input::passwordMessages('newPassword'));
        $this->auth->changePassword($this->actor($request), $input['currentPassword'], $input['newPassword']);

        return $this->json(['ok' => true]);
    }

    public function updateUsername(Request $request): JsonResponse
    {
        $data = $this->body($request);
        $data['username'] = Input::email($data['username'] ?? null);
        $input = Input::validate($data, ['username' => Input::usernameRules()], Input::usernameMessages('username'));
        $this->auth->updateUsername($this->actor($request), $input['username'] ?? null);

        return $this->json(['ok' => true]);
    }

    public function sessions(Request $request): JsonResponse
    {
        return $this->json($this->auth->listSessions($this->actor($request)));
    }

    public function revokeSession(Request $request, string $id): JsonResponse
    {
        $this->auth->revokeSession($this->actor($request), $id);

        return $this->json(['ok' => true]);
    }

    private function withNewSession(JsonResponse $response, string $token): JsonResponse
    {
        return $response
            ->withCookie(Cookies::session(Cookies::SESSION, $token, Cookies::SESSION_MAX_SECONDS))
            ->withCookie(Cookies::csrf(Tokens::random()));
    }
}
