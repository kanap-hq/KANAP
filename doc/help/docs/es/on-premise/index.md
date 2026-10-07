# Despliegue local

KANAP puede desplegarse de forma local en **modo de inquilino único**. Usted proporciona su propia base de datos PostgreSQL, almacenamiento compatible con S3 y proxy inverso con TLS. KANAP se encarga de todo lo demás: las migraciones se ejecutan automáticamente, el espacio de trabajo y el usuario administrador se crean en el primer arranque, y un límite generoso de puestos (1.000) viene preconfigurado.

## Guías

- **[Instalación](installation.md):** Clonar, compilar, configurar e iniciar
- **[Ejemplo de instalación](installation-example.md):** Tutorial paso a paso en Ubuntu 24.04 con PostgreSQL, MinIO y nginx
- **[Instalación asistida por IA](installation-ai.md):** Instalación con un solo prompt mediante un agente de programación con IA
- **[Configuración](configuration.md):** Referencia de variables de entorno
- **[Operaciones](operations.md):** Actualizaciones, copias de seguridad, monitorización, resolución de problemas
- **[SSO con Microsoft Entra](sso-entra.md):** Inicio de sesión único opcional con Microsoft Entra ID

## Qué se incluye

- Funcionalidad completa de la aplicación (presupuestos, contratos, portafolio, operaciones IT, informes)
- Migraciones automáticas de la base de datos al iniciar
- Aprovisionamiento en el primer arranque (espacio de trabajo, usuario administrador, suscripción)
- Autenticación local mediante usuario/contraseña (sin dependencias externas)
- Correo electrónico opcional vía API de Resend o SMTP gestionado por el cliente
- SSO opcional con Microsoft Entra

## Qué está deshabilitado

- **Facturación / Stripe:** Deshabilitado automáticamente (no se necesita gestión de suscripciones)
- **Administración de plataforma:** Solo inquilino único, sin superficies de gestión multi-inquilino
- **Endpoints de prueba / facturación de soporte:** No aplicables al despliegue local

## Notas rápidas

- `DEPLOYMENT_MODE=single-tenant` es el único conmutador que activa el modo local.
- `APP_BASE_URL` debe coincidir con la dirección exacta que abren los usuarios (incluido un puerto no estándar) para los enlaces de correo, las redirecciones de inicio de sesión y las exportaciones. Ponga la misma dirección en `CORS_ORIGINS`.
- Para correo saliente, elija **Resend** o **SMTP**. SMTP está pensado solo para despliegues de inquilino único / locales.
- El backend devuelve respuestas estructuradas `FEATURE_DISABLED` para las funciones deshabilitadas — la interfaz las oculta automáticamente.
