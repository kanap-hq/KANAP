# Instalación asistida por IA

En lugar de seguir usted mismo el [recorrido paso a paso](installation-example.md), puede confiárselo a un agente de programación con IA. El agente lee el recorrido y lo ejecuta en su servidor, paso a paso. Un prompt, un servidor, un resultado.

Herramientas como [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) u [OpenAI Codex](https://openai.com/index/codex/) pueden leer la documentación de KANAP, instalar todas las dependencias, configurar todos los servicios y verificar el resultado, normalmente en menos de 20 minutos.

## Requisitos previos

| Requisito | Detalles |
|-------------|---------|
| **Servidor** | Ubuntu 26.04 LTS (24.04 LTS funciona), recién instalado, con 6 GB de RAM o más (8 GB recomendados; la compilación de las imágenes necesita ese margen), un usuario con acceso sudo y acceso saliente a internet durante la instalación (paquetes, imágenes Docker, GitHub, y Let's Encrypt si lo usa) |
| **Nombre** | El nombre que escriben los usuarios para abrir KANAP. Solo hace falta un registro DNS público para Let's Encrypt. En otro caso, use un registro en el DNS de su empresa, o una entrada en el archivo hosts para una prueba (consulte [Nombre y certificado](installation.md#nombre-y-certificado)). |
| **Certificado** | Uno de tres casos: un nombre público con Let's Encrypt, archivos de certificado de su autoridad interna ya presentes en el servidor, o un certificado autofirmado para una prueba |
| **Agente de IA** | Un agente de programación con IA instalado en el servidor (Claude Code, Codex o similar) |

### sudo sin contraseña

El agente de IA ejecuta muchos comandos con `sudo`. Para que no se le pida una contraseña en cada paso, conceda temporalmente a su usuario sudo sin contraseña:

```bash
echo "$USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/90-install-nopasswd
sudo chmod 0440 /etc/sudoers.d/90-install-nopasswd
```

Lo eliminará al final de la instalación: consulte [Después de la instalación](#despues-de-la-instalacion).

## El prompt

Abra su agente de IA en el servidor y pegue el siguiente prompt. Sustituya los valores de la lista **Parameters** por los suyos y conserve una sola línea **Certificate**.

```
Install KANAP on this Ubuntu server by following the official installation
example step by step, running its commands as written:

  https://doc.kanap.net/on-premise/installation-example/

Background pages: https://doc.kanap.net/on-premise/installation/ and
https://doc.kanap.net/on-premise/configuration/

Parameters:
- Address users open: https://kanap.example.com
- Administrator email: admin@example.com
- Organization name: Example Company
- Certificate (keep one line):
  - Public name: get a certificate from Let's Encrypt, with automatic renewal.
  - Internal certificate: the files are on this server at <path of the full
    chain> and <path of the private key>.
  - Test only: create a self-signed certificate.

Rules:
1. Follow the steps of the guide in order. Use the commands as they are
   written; where the guide shows a choice (Ubuntu 24.04, certificate case),
   take the one that matches this server and my parameters above.
2. Generate every secret on the server, as the guide's step 0 does. Never
   print a secret in the conversation and never write one to the log file.
3. Keep a log of your work in ~/kanap-install.md: the commands you ran, the
   configuration files you wrote (without secrets), and what you saw. For the
   secrets, write only where they are stored: ~/kanap-install.env (deleted at
   the end), /opt/kanap/.env and /etc/default/rustfs.
4. If the docker group is not active in your shell yet, put sudo in front of
   the docker commands.
5. Keep SSH allowed in the firewall before you enable it.
6. Run the checks of the guide's step 9, including the smoke test. Read the
   administrator password from /opt/kanap/.env into the environment of that
   command without printing it.
7. When you finish, report: the start-up lines of the API log (the [ENV],
   [SECRETS], [RATE-LIMIT], [CORS], [DB], [on-prem] and [SECURITY] lines and
   any WARN), the output of docker compose ps, the last line of the smoke
   test, and anything that did not work as the guide says.
```

### Configuración del correo

Añada **uno** de los bloques siguientes al prompt para activar el correo saliente (restablecimiento de contraseña, invitaciones, notificaciones). El agente añade los valores al archivo `.env`.

**Opción A: Resend** (API de correo en la nube):

```
Email transport: Resend
- RESEND_API_KEY=re_xxxxx
- RESEND_FROM_EMAIL=KANAP <noreply@example.com>
```

**Opción B: SMTP** (relay interno o proveedor):

```
Email transport: SMTP
- SMTP_HOST=smtp.company.com
- SMTP_PORT=587
- SMTP_SECURE=false
- SMTP_USER=noreply@company.com
- SMTP_PASSWORD=secret
- SMTP_FROM=KANAP <noreply@company.com>
```

Sustituya los valores por sus credenciales reales. SMTP_USER y SMTP_PASSWORD van juntos. Si omite la configuración del correo, KANAP funciona igualmente, pero el restablecimiento de contraseña y las invitaciones no están disponibles hasta que configure el correo más adelante (consulte [Configuración](configuration.md)).

## Qué esperar

El agente lee el recorrido y después lo sigue:

1. **Paquetes del sistema**: instala Docker y Git.
2. **Cortafuegos**: permite SSH, HTTP y HTTPS desde la red, y PostgreSQL y el almacenamiento solo desde las redes Docker.
3. **Archivos de KANAP**: clona el repositorio en `/opt/kanap` y cambia a `stable`.
4. **PostgreSQL**: lo instala, crea la base de datos, el rol de aplicación y las extensiones necesarias, y permite la conexión de las redes Docker.
5. **Almacenamiento de objetos**: instala RustFS, crea el bucket, un usuario de aplicación restringido y la clave de cifrado.
6. **KANAP**: escribe `.env` con los secretos generados, compila las imágenes Docker y arranca los contenedores.
7. **TLS y nginx**: obtiene o crea el certificado, configura el proxy inverso y se asegura de que el servidor resuelve el nombre.
8. **Verificación**: comprueba el estado de la API y del frontend, y después ejecuta la prueba de humo (base de datos, almacenamiento, inicio de sesión, exportaciones).

El agente pide confirmación antes de ejecutar comandos en su servidor. Cuando termina, le entrega el informe descrito en el prompt. El registro de la instalación está en `~/kanap-install.md`.

## Después de la instalación

1. **Lea el informe.** Revise las líneas de arranque: una advertencia `[SECURITY]`, `[CONFIG]` o `[CORS]`, o una línea `[ENV] APP_ENV is not set`, indica que un parámetro requiere atención (consulte [Configuración](configuration.md#que-muestra-el-registro-de-la-api-al-arrancar)).
2. **Revise su archivo `.env`** en `/opt/kanap/.env`. Solo su propietario puede leerlo y contiene todos los secretos.
3. **Configure el correo** si aún no lo ha hecho: consulte [Configuración](configuration.md) para SMTP o Resend, y después [pruébelo](configuration.md#probar-el-correo). El correo permite el restablecimiento de contraseña, las invitaciones y las notificaciones.
4. **Inicie sesión** en `https://su-direccion` con `ADMIN_EMAIL` y el `ADMIN_PASSWORD` de `.env`: `grep '^ADMIN_PASSWORD=' /opt/kanap/.env` lo muestra. Cámbiela en su perfil si quiere una que solo usted conozca.
5. **Añada su logotipo y sus colores** en **Administración → Personalización** (opcional).
6. **Configure las copias de seguridad** y lea la guía de [Operaciones](operations.md) para las actualizaciones y la monitorización.
7. **Conserve la clave de cifrado.** `/etc/default/rustfs` contiene la clave que cifra los archivos almacenados. Guárdela con la copia de seguridad de la configuración.
8. **Elimine el sudo sin contraseña.** La instalación ha terminado, restablezca la seguridad normal:

    ```bash
    sudo rm /etc/sudoers.d/90-install-nopasswd
    ```

!!! tip "El mismo resultado, otro camino"
    Este prompt produce la misma instalación que el [recorrido manual](installation-example.md). Si más adelante necesita diagnosticar o personalizar componentes concretos, esa guía sigue siendo la referencia.
