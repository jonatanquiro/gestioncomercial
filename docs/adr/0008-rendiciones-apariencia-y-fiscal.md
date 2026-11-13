# ADR 0008 · Rendiciones, personalización y primera integración fiscal

**Estado:** aceptada el 2026-10-26.

## Decisiones

1. **Rendir por cuenta o terminal**, representada por un medio de pago con nombre propio y tipo correcto. El proveedor se identifica en la rendición. No se supone que todo QR, transferencia o débito pertenece a Mercado Pago. La primera etapa admite CSV con columnas configurables y revisión manual; no se incorporan todavía conectores automáticos.
2. **Cruce conservador.** La coincidencia automática requiere una referencia única dentro del período y un bruto idéntico. Una operación ambigua permanece pendiente. La vinculación manual y las diferencias requieren motivo. Cada cobro puede estar en una sola rendición y no hay superposición entre períodos abiertos de la misma cuenta. Luego del cierre, otra rendición puede recoger cobros posteriores de esas fechas, sin repetir los ya incluidos. Se serializa la importación por comercio y se rechazan identificadores ya importados de la misma cuenta, también entre rendiciones. Importación, revisión y cierre tienen auditoría. El cierre no modifica ventas ni caja.
3. **Apariencia en el comercio.** `tenants.appearance` contiene valores validados. El logo es un bitmap pequeño en una URL de datos validada, sin SVG ni archivos ejecutables. La marca del comercio se aplica a sus usuarios y tickets; la plataforma conserva su propia apariencia. Los colores se validan por legibilidad. Se puede elegir menú lateral o superior.
4. **Cambio de plan individual.** El panel modifica la suscripción existente bajo bloqueo del comercio y valida su consumo contra el plan destino. No hay reinicio de prueba, cambio automático de estado ni cobro. Se exige motivo y control del plan esperado para detectar ediciones simultáneas.
5. **ARCA por comercio y ambiente.** Las claves, certificados y tickets WSAA se cifran con `APP_KEY` en la base. Se reutilizan ideas de autenticación y generación CSR de `gestion-silvia/inc/arca.php`, sin importar secretos. No se desactiva la verificación TLS ni se reduce su nivel de seguridad. Las respuestas XML se leen con namespaces y sin entidades externas.
6. **Emisión con intención persistida.** Para bienes en ARS sin otros tributos, los importes fiscales salen de las alícuotas y totales de las líneas congeladas. La intención, tipo y número se guardan antes del pedido de CAE. Un reintento pendiente consulta el número original y valida sus importes/documento/fecha antes de asociar una autorización. Se serializa por comercio y ambiente mediante locks de caché compartida. Usar un punto de venta dedicado a esta aplicación. Las respuestas inciertas bloquean nuevas emisiones hasta resolverlas.

## Alcance y limitaciones

La primera integración fiscal contempla facturas A/B/C de bienes en pesos. No cubre notas de crédito, servicios, otras monedas, impuestos internos, otros tributos ni comprobantes especiales. Se bloquean anulaciones/devoluciones comerciales cuando hay factura real autorizada o pendiente. Debe validarse el circuito en homologación con credenciales habilitadas antes de usar producción; las pruebas automáticas no prueban la habilitación real del contribuyente.

Las devoluciones y otros movimientos negativos de proveedores de cobro se resuelven como observaciones en esta primera rendición; el importador acepta únicamente cobros positivos. No se anuncian como conciliación automática contra cuentas externas.

## Verificación

- Pruebas unitarias PHP de CSV, importes y XML fiscal.
- Integración con MariaDB aislada: importación y duplicados, cierre, permisos, aislamiento multiempresa, apariencia, cambio de planes y emisión/recuperación de CAE con HTTP simulado.
- Compilación de la SPA y revisión en navegador. Los E2E admiten ambas ubicaciones de menú.
