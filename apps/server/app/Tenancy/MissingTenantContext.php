<?php

namespace App\Tenancy;

use LogicException;

/** Se intentó leer o escribir datos de un comercio sin comercio en contexto. Falla cerrado. */
class MissingTenantContext extends LogicException {}
