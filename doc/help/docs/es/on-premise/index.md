# Despliegue on-premise

KANAP puede desplegarse on-premise en **modo de un solo espacio de trabajo** (single-tenant). Usted aporta su propio PostgreSQL, un almacenamiento compatible con S3 y un proxy inverso con TLS. KANAP se encarga del resto: las migraciones se ejecutan automáticamente y el espacio de trabajo y el usuario administrador se crean en el primer arranque. No hay límite de usuarios.

## Guías

- **[Instalación](installation.md):** requisitos, nombre y certificado, clonado, compilación, configuración y arranque
- **[Ejemplo de instalación](installation-example.md):** recorrido paso a paso en Ubuntu 26.04 con PostgreSQL, RustFS, un cortafuegos y nginx
- **[Instalación asistida por IA](installation-ai.md):** instalación con un solo prompt mediante un agente de programación con IA
- **[Configuración](configuration.md):** referencia de las variables de entorno, líneas de arranque, trabajos en segundo plano y reglas de cortafuegos
- **[Operaciones](operations.md):** versiones y actualizaciones, copia de seguridad y restauración, monitorización y solución de problemas
- **[SSO con Microsoft Entra](sso-entra.md):** inicio de sesión único opcional con Microsoft Entra ID

## Qué incluye

- Todas las funciones de la aplicación (presupuestos, contratos, portafolio, operaciones IT, informes)
- Migraciones automáticas de la base de datos al arrancar
- Aprovisionamiento en el primer arranque (espacio de trabajo, usuario administrador, suscripción)
- Autenticación local con usuario y contraseña (sin dependencias externas)
- Correo opcional mediante la API de Resend o un SMTP gestionado por el cliente
- SSO opcional con Microsoft Entra
- Funciones de IA opcionales, con su propio proveedor

## Qué está desactivado

- **Facturación / Stripe:** desactivada automáticamente (no hace falta gestionar suscripciones)
- **Administración de la plataforma:** solo hay un espacio de trabajo, sin pantallas de gestión multiespacio
- **Endpoints de prueba y de facturas de soporte:** no se aplican on-premise

## Notas rápidas

- **Versiones.** KANAP publica una versión aproximadamente una vez al mes (`26.10.1` es la primera). Usted instala la rama `stable`, que siempre apunta a la última versión publicada, y actualiza descargándola tras leer `CHANGELOG.md`. Actualice al menos una vez al mes. Consulte [Operaciones](operations.md#procedimiento-de-actualizacion).
- **Plataforma.** El ejemplo usa Ubuntu 26.04 LTS (Ubuntu 24.04 funciona). Se admite cualquier sistema operativo con Docker Engine 24+ y el plugin Docker Compose 2.20 o posterior (las versiones actuales son 5.x).
- **Almacenamiento.** El ejemplo ejecuta RustFS en el servidor. Funciona cualquier almacenamiento compatible con S3, y un MinIO existente sigue funcionando.
- **Redes internas.** No hace falta DNS público. Use un nombre del DNS de su empresa (o una entrada en el archivo hosts para una prueba) con un certificado de su autoridad interna. Consulte [Nombre y certificado](installation.md#nombre-y-certificado).
- `DEPLOYMENT_MODE=single-tenant` es el único interruptor que activa el modo on-premise.
- `APP_BASE_URL` debe coincidir con la dirección exacta que abren los usuarios (incluido un puerto no estándar) para los enlaces de los correos, las redirecciones de inicio de sesión y las exportaciones. Ponga la misma dirección en `CORS_ORIGINS`.
- Para el correo saliente, elija **Resend** o **SMTP**. SMTP está pensado solo para despliegues single-tenant/on-premise.
- La aplicación oculta automáticamente las funciones desactivadas on-premise.
