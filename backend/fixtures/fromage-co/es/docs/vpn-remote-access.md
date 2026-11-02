# Guía de VPN y acceso remoto

Todo el acceso remoto a la red de Fromage & Co pasa por **FortiClient VPN** con **Okta MFA**. La pasarela VPN está alojada en el clúster FortiGate del centro de datos de París (PAR-DC1).

## Solicitar acceso VPN

1. Abra una solicitud en ServiceNow en **IT > Access > VPN**.
2. Su responsable aprueba la solicitud; TI y Digital configura el perfil.
3. Recibirá un correo con el enlace de instalación de FortiClient y la dirección de la pasarela (`vpn.fromage-co.example`).

El plazo estándar es de **1 día hábil**. El personal de Producción y Calidad recibe automáticamente acceso al segmento de red de planta.

## Conexión

1. Inicie FortiClient y seleccione el perfil **Fromage & Co**.
2. Introduzca su correo corporativo y su contraseña.
3. Apruebe la notificación push de Okta en su teléfono.

## Problemas frecuentes

- **«Credenciales rechazadas» tras un cambio de contraseña**: FortiClient guarda en caché su contraseña anterior. Haga clic en *Desconectar* y, en la configuración del perfil, borre la contraseña guardada e introduzca la nueva. Es el ticket de VPN más frecuente.
- **No llega la notificación push de Okta**: abra manualmente la aplicación Okta Verify; si ha cambiado de teléfono, pida al centro de servicios que restablezca su factor MFA.
- **Conectado, pero SAP no responde**: el segmento de planta requiere el grupo VPN *Producción*. Compruebe con el centro de servicios que su perfil lo incluye.

## Teletrabajo

La VPN es necesaria para SAP, las carpetas compartidas y el Cave Monitoring Dashboard. Microsoft 365 (Teams, Exchange, SharePoint) funciona sin VPN. Desconecte la VPN cuando solo use Teams: la capacidad del túnel es compartida y los viernes por la mañana ya hay bastante movimiento en las cavas.
