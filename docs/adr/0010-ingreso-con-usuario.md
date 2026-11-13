# 0010: Ingreso con nombre de usuario o email

Los comercios suman cajeros y vendedores que no tienen casilla de correo o no quieren usarla en el trabajo. Exigir un email obligaba a inventar direcciones.

Cada persona tiene un nombre de usuario opcional, único en todo el sistema como el email, porque la identidad es global (ADR 0003). El nombre de usuario se guarda en minúsculas, tiene entre 3 y 30 caracteres y admite letras sin acentos, números, punto, guion y guion bajo. No admite `@`: así el campo de ingreso distingue un email de un nombre de usuario sin ambigüedad.

El email pasa a ser opcional para los empleados. El propietario lo sigue necesitando al registrarse o cuando lo invita la plataforma, porque es el canal de recuperación de la cuenta. Toda persona tiene al menos uno de los dos. Quien no tiene email no puede recuperar la contraseña por correo: la restablece alguien con permiso sobre los empleados. Cada persona puede elegir o cambiar su nombre de usuario desde Mi cuenta.

El panel de plataforma sigue ingresando solo con email.
