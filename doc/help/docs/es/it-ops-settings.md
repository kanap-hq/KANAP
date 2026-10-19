# Configuración del panorama IT

La página de **Configuración del panorama IT** le permite personalizar los valores de los desplegables utilizados en todo el Panorama IT. Estas listas controlan qué opciones aparecen cuando los usuarios crean o editan Aplicaciones, Interfaces, Activos, Conexiones y Ubicaciones. Los cambios aquí se aplican a todos los usuarios de su espacio de trabajo.

Para la legibilidad del mapa, las **Entidades** y **Roles de servidor** también incluyen un campo de **Nivel del grafo** utilizado por la ubicación basada en roles del Mapa de conexiones.

## Dónde encontrarla

- Espacio de trabajo: **Panorama IT**
- Ruta: **Panorama IT > Configuración**
- Permisos:
  - Necesita al menos `settings:reader` para ver la página.
  - Necesita `settings:admin` para cambiar valores.

Si no ve la entrada **Configuración** en el cajón del Panorama IT, solicite a su administrador que le otorgue los permisos apropiados.

## Cómo está organizada la página

El editor **Clasificaciones y continuidad** está en la parte superior de la página. Debajo, las listas se agrupan en cuatro secciones plegables:

1. **Ubicaciones** - Listas utilizadas al crear o editar ubicaciones.
2. **Servidores y conexiones** - Listas utilizadas para servidores, conexiones y datos de riesgo/endpoint relacionados.
3. **Aplicaciones, servicios e interfaces** - Listas utilizadas en aplicaciones, instancias de aplicación, interfaces y enlaces.
4. **Incidentes** - Listas utilizadas por el registro de incidentes.

Las listas de las tecnologías están en dos secciones: **Familias de tecnologías** y **Zonas de administración** en **Servidores y conexiones**, **Tipos de alojamiento** en **Ubicaciones**. Otras pantallas llaman a esta página los ajustes de TI.

Dentro de una sección, las listas se ordenan por nombre. Cada lista aparece como un panel expandible con una breve indicación de dónde se usan sus valores (por ejemplo, *Aplicaciones / Selector de categoría*). Haga clic en el encabezado de un panel para expandirlo y ver los valores. Solo una sección carga su contenido cuando la expande por primera vez, lo que mantiene la página rápida incluso cuando tiene muchas listas.

### Controles del editor

Cada lista tiene sus propios controles en la parte superior:

- **Agregar elemento** - Inserta una nueva fila en la parte superior de la lista, enfocada y lista para escribir. Su campo de nombre muestra un ejemplo propio de esa lista.
- Las ediciones se guardan automáticamente alrededor de un segundo y medio después de su último cambio, una vez que todas las filas son válidas. Un indicador de guardado se muestra junto a la lista.

Para listas largas (más de 25 filas), la tabla virtualiza filas, mostrando unas 20 a la vez con desplazamiento suave y encabezados fijos.

### Los nombres son la identidad de un valor

Usted solo ve y escribe **nombres**. KANAP genera un código interno estable a partir del nombre cuando un valor se guarda por primera vez y lo conserva para siempre, de modo que renombrar un valor nunca rompe los registros que lo usan. El código es visible para los integradores en la API y puede usarse en archivos CSV, pero la exportación CSV escribe nombres y la importación acepta cualquiera de los dos.

Como los nombres identifican los valores, dentro de una lista se aplican algunas reglas:

- todo valor necesita un nombre (un asterisco marca la columna **Nombre**), y dos valores no pueden tener el mismo nombre (las mayúsculas y minúsculas no importan);
- un nombre no puede ser idéntico al código interno de otro valor de la misma lista;
- los nombres de los **Métodos de acceso** no pueden contener una coma ni un punto y coma, porque la exportación CSV los lista en una sola celda separada por comas.

Una lista que incumple una de estas reglas no se guarda hasta que la corrija; la fila muestra qué está mal.

### Eliminar un valor

**Eliminar** borra un valor que nada utiliza. Cuando todavía hay registros que hacen referencia al valor, KANAP muestra cuántos (aplicaciones, activos, interfaces, conexiones, ubicaciones, incidentes, subredes…), con un enlace a la lista filtrada cuando una lista se puede filtrar por ese campo, y ofrece **Dejar de proponer** en su lugar: el valor sigue visible en los registros que ya lo usan y ya no se propone para los nuevos. Un valor en uso nunca se elimina, ni siquiera a través de la API.

Los valores integrados que KANAP gestiona por sí mismo (los cuatro estados del ciclo de vida, los dominios Workgroup y N/A) no se pueden editar ni eliminar. Las zonas de red y los tipos de activo predeterminados se pueden editar y retirar, pero no eliminar: el servidor los volvería a añadir.

### Traducir sus valores

Los valores que escribe se muestran tal cual en todos los idiomas. Para mostrarlos en el idioma de cada usuario, use la acción **Traducir** en una fila: el cuadro de diálogo presenta el nombre base (y la descripción en los niveles de clasificación) y un campo por idioma. Un campo dejado vacío usa la traducción automática mientras el valor siga siendo un valor predeterminado de KANAP; de lo contrario, el texto base. Guardar las traducciones nunca cambia el texto base, y un nombre traducido se puede usar en los archivos CSV y en la API igual que el propio nombre, por lo que no debe duplicar otro valor de la lista.

Los editores siempre muestran y editan el texto base; cuando el nombre mostrado difiere en su idioma, la fila lo indica («Se muestra: …»).

---

## Ubicaciones

### Proveedores cloud

Proveedores cloud utilizados por los servidores y las ubicaciones (p. ej., AWS, Azure, GCP).

**Columnas**: Nombre, Dejar de proponer

**Dónde se usa**:
- Espacio de trabajo de Activos → pestaña Visión general → campo **Proveedor**
- Espacio de trabajo de Ubicaciones → pestaña Visión general → **Proveedor cloud** (cuando el tipo de alojamiento es cloud)

### Tipos de alojamiento

Dónde se alojan las ubicaciones y las tecnologías. Valores por defecto: Local, Colocation, Cloud público, Cloud privado, SaaS.

**Columnas**: Nombre, Categoría (**Local / colocación** o **Nube / SaaS**), Dejar de proponer

**Dónde se usa**:
- Espacio de trabajo de Ubicaciones → pestaña Visión general → campo **Tipo de alojamiento**
- Espacio de trabajo de Tecnologías → panel de propiedades → **Tipo de alojamiento**, y la ventana de nueva tecnología. Consulte [Tecnologías](technologies.md#tipo-de-alojamiento).

Un tipo que usa una tecnología no se puede eliminar: márquelo con **Dejar de proponer**.

La categoría determina qué campos aparecen al editar una Ubicación:
- **Local / colocación** muestra campos de Empresa operadora y Centro de datos
- **Nube / SaaS** muestra campos de Proveedor cloud, Región e Información adicional

---

## Servidores y conexiones

### Zonas de administración

Las zonas de su modelo de administración. KANAP incluye los tres tiers del modelo de administración por tiers, una buena práctica reconocida:

- **Tier 0 (núcleo de confianza)**: directorios como Active Directory o Entra ID, PKI, herramientas de administración de identidades y los sistemas que los alojan.
- **Tier 1 (servidores y aplicaciones)**: servidores de negocio, aplicaciones, bases de datos y middleware.
- **Tier 2 (puestos de trabajo)**: puestos de trabajo y dispositivos de los usuarios.

Cámbieles el nombre, añada los suyos o deje de proponerlos según su política de administración o su modelo de acceso privilegiado. Los tres tiers aparecen mientras la lista no se haya guardado nunca. Una vez guardada la lista, aunque esté vacía, KANAP ya no los añade: añádalos usted mismo si los necesita.

El orden de la lista importa: la primera zona es la más sensible. Arrastre una fila por su asa para moverla. Una zona nueva se añade arriba: muévala después a su lugar. La página [Zonas de administración](administration-view.md) muestra las zonas en este orden y compara los activos con la primera zona que no está marcada con **Dejar de proponer**.

**Columnas**: Nombre, Grupo de administradores, Descripción, Dejar de proponer

- **Grupo de administradores**: el grupo del directorio o el equipo que administra la zona, por ejemplo «Admins. del dominio».

**Dónde se usa**:
- Espacio de trabajo de Activos → panel de propiedades → **Zona de administración**
- Espacio de trabajo de Tecnologías → panel de propiedades → **Zona de administración**, para las tecnologías de la familia **Directorio e identidad**
- **Panorama IT > Zonas de administración**, que cuenta los activos y los servicios de directorio de cada zona, ejecuta los puntos de control y asigna zonas en bloque. Consulte [Zonas de administración](administration-view.md).

Una zona marcada con **Dejar de proponer** se mantiene en las tecnologías y los activos ya situados en ella.

### Familias de tecnologías

El tipo de cada tecnología: base de datos, hipervisor, directorio e identidad, etc. La lista de tecnologías y los informes agrupan las tecnologías por familia, y la página [Zonas de administración](administration-view.md) encuentra los servicios de directorio por la familia **Directorio e identidad**.

**Columnas**: Nombre, Dejar de proponer

**Dónde se usa**:
- Espacio de trabajo de Tecnologías → cabecera y panel de propiedades → **Familia**, y la ventana de nueva tecnología

La familia **Sistema operativo** identifica los sistemas operativos: una tecnología de esa familia añadida a un servidor que no tiene ninguno pasa a ser su sistema operativo. Consulte [Tecnologías](technologies.md#sistemas-operativos).

### Tipos de conexión

Un catálogo de dos niveles (categoría y entrada) de protocolos de conexión, con los puertos típicos.

**Columnas**: Categoría (p. ej., Base de datos, Acceso remoto), Nombre, Puertos típicos, Dejar de proponer

**Dónde se usa**:
- Espacio de trabajo de Conexiones → selector de **Tipo de conexión**

El campo **Puertos típicos** es texto libre - puede introducir puertos individuales (`443`), listas (`80, 443`), rangos (`9101-9103`) o marcadores de posición como `multiple` o `specify`.

Las categorías predeterminadas incluyen: Aplicación, Autenticación, Respaldo, Base de datos, Correo, Compartir archivos, Transferencia de archivos, Mensajería, Monitorización, Servicios de red, Acceso remoto, Replicación, Almacenamiento, VPN / Túnel, Genérico.

### Dominios

Dominios Active Directory o DNS de los activos. Las entradas integradas no se pueden modificar. El sufijo DNS se usa para calcular el nombre de dominio completamente cualificado (FQDN) de cada activo.

**Columnas**: Nombre, Sufijo DNS, Bosque, Número de cuentas, Número de equipos, Confianzas, Dejar de proponer

- **Bosque**: el bosque de Active Directory del dominio, tal como aparece en Dominios y confianzas de Active Directory.
- **Número de cuentas** y **Número de equipos**: el número de cuentas de usuario y de equipos del dominio, tal como se cuentan en Usuarios y equipos de Active Directory o con un recuento de los objetos de usuario y de equipo del dominio. Solo números enteros.

Pase el cursor sobre los encabezados **Bosque**, **Número de cuentas** y **Número de equipos** para ver dónde encontrar cada valor.
- **Confianzas**: el botón indica cuántas confianzas tiene el dominio. Haga clic en él para listar los otros dominios con los que tiene una relación de confianza, tal como aparecen en Dominios y confianzas de Active Directory. **Añadir un dominio de confianza** añade uno; elija su **Dirección**: **saliente** (este dominio confía en el otro, cuyas cuentas pueden acceder a sus recursos), **entrante** (el otro dominio confía en este) o **bidireccional** (ambos). El cuadro de diálogo muestra también, en solo lectura, las confianzas declaradas en otros dominios hacia este. El botón aparece una vez guardado el dominio, y necesita al menos otro dominio en la lista.

**Dónde se usa**:
- Espacio de trabajo de Activos → pestaña Técnico → selector de **Dominio**
- Espacio de trabajo de Activos → pestaña Técnico → **FQDN** (calculado automáticamente desde hostname + sufijo DNS)
- **Panorama IT > Zonas de administración**: dominios agrupados por bosque, con sus confianzas, recuentos y controladores de dominio. Consulte [Zonas de administración](administration-view.md#servicios-de-directorio-y-dominios).

**Entradas del sistema** (no pueden modificarse ni eliminarse):
- **Workgroup** - Para activos independientes no unidos a un dominio
- **N/A** - Para tipos de activo donde la pertenencia a dominio no aplica (p. ej., dispositivos de red, racks)

**Comportamiento de auto-relleno**: Al añadir un nuevo dominio, el sufijo DNS se auto-rellena a partir del nombre que introduzca hasta que usted lo edite.

**Ejemplo**: Un dominio llamado "Corporate AD" con sufijo DNS `corp.example.com` produciría un FQDN de `hostname.corp.example.com` para un activo con hostname `web-server-01`.

### Entidades

Endpoints utilizados en conexiones y mapas (p. ej., Usuarios internos, Internet, Redes de partners, Sistemas externos). El nivel del grafo define su posición predeterminada en el mapa.

**Columnas**: Nombre, Nivel del grafo, Dejar de proponer

**Dónde se usa**:
- Espacio de trabajo de Conexiones → campos de **Entidad de origen** y **Entidad de destino**
- Mapa de conexiones → las entidades aparecen como endpoints de flujo y usan su nivel del grafo para la ubicación vertical (las entidades predeterminadas son Superior)

### Valores del nivel del grafo

El nivel del grafo controla la banda vertical preferida en el Mapa de conexiones cuando la **Ubicación basada en roles** está habilitada:

- **Superior**: Endpoints más orientados al usuario o externos
- **Medio superior**: Capa de aplicación/servicio superior
- **Centro**: Capa media neutral/predeterminada
- **Medio inferior**: Infraestructura de soporte
- **Inferior**: Endpoints pesados en datos/almacenamiento

### Tipos de dirección IP

Tipos de direcciones IP de los activos. Útil para distinguir entre diferentes interfaces de red como IPs de host, interfaces de gestión y redes de almacenamiento.

**Columnas**: Nombre, Dejar de proponer

**Valores predeterminados**: Host, IPMI, Gestión, iSCSI

**Dónde se usa**:
- Espacio de trabajo de Activos → pestaña Técnico → sección **Direcciones IP** → desplegable de **Tipo**

Los activos pueden tener múltiples direcciones IP, cada una con su propio tipo. Por ejemplo, un servidor físico podría tener:
- Una IP de **Host** para tráfico de aplicaciones
- Una IP **IPMI** para gestión fuera de banda
- Una IP **iSCSI** para conectividad de red de almacenamiento

### Zonas de red

Zonas de red utilizadas para clasificar las subredes y describir la conectividad (p. ej., LAN, DMZ, LAN industrial, WiFi, Nube pública, Invitados, Gestión, Almacenamiento, VPN).

**Columnas**: Nombre, Dejar de proponer

**Dónde se usa**:
- Lista de subredes → selector de **Zona de red**
- Espacio de trabajo de Activos → pestaña Técnico → **Zona de red** (auto-rellenada cuando se selecciona una subred)

### Subredes

Defina las subredes con notación CIDR y, si procede, su VLAN. Cada subred pertenece a una zona de red y a una ubicación.

**Columnas**: Ubicación, CIDR, VLAN (1-4094), Zona de red, Descripción, Dejar de proponer

**Dónde se usa**:
- Espacio de trabajo de Activos → pestaña Técnico → selector de **Subred**

**Reglas de validación**:
- CIDR debe ser notación IPv4 válida (p. ej., `192.168.1.0/24`)
- Los números de VLAN deben estar entre 1 y 4094
- CIDR y números de VLAN son únicos por ubicación (los mismos valores pueden existir en diferentes ubicaciones)

**Auto-rellenado**: Cuando selecciona una subred en un Activo, la Zona de red se rellena automáticamente desde la configuración de la subred.

### Roles de servidor

Roles asignados a los servidores al vincular instancias de aplicación (p. ej., Servidor web, Servidor de base de datos, Worker). El nivel del grafo define su posición en el mapa de conexiones.

**Columnas**: Nombre, Nivel del grafo, Dejar de proponer

**Dónde se usa**:
- Espacio de trabajo de Aplicaciones → pestaña Servidores → desplegable de **Rol** al vincular un activo a una instancia
- Mapa de conexiones → banda de ubicación derivada del rol para servidores y clústeres

Ejemplos predeterminados integrados:
- `web`, `proxy` → **Superior**
- `app`, `cloud-service` → **Medio superior**
- `db` → **Inferior**

### Tipos de activo

Tipos lógicos de servidores y activos de infraestructura (p. ej., Servidor físico, Máquina virtual, Contenedor, Serverless, Appliance). Los activos físicos pueden registrar información de hardware y soporte.

**Columnas**: Nombre, Físico, Dejar de proponer

**Dónde se usa**:
- Espacio de trabajo de Activos → pestaña Visión general → campo **Tipo**

---

## Aplicaciones, servicios e interfaces

### Métodos de acceso

Métodos con los que los usuarios acceden a las aplicaciones (p. ej., web, móvil, VDI).

**Columnas**: Nombre, Dejar de proponer

**Valores predeterminados**: Web, Aplicación instalada localmente, Aplicación móvil, HMI propietario (interfaz industrial), Terminal / CLI, VDI / Escritorio remoto, Kiosk

**Dónde se usa**:
- Espacio de trabajo de Aplicaciones → pestaña Técnico y soporte → campo de selección múltiple **Métodos de acceso**

**Consejo**: Personalice los métodos de acceso para que coincidan con cómo su organización categoriza el acceso a aplicaciones. Por ejemplo, añada "Citrix" o "Cliente ligero" si son patrones de acceso comunes en su entorno.

### Categorías de aplicación

Categorías que describen el propósito principal de cada aplicación o servicio.

**Columnas**: Nombre, Dejar de proponer

**Valores predeterminados**: Línea de negocio, Productividad, Seguridad, Analítica, Desarrollo, Integración, Infraestructura

**Dónde se usa**:
- Espacio de trabajo de Aplicaciones → pestaña Visión general → campo **Categoría**
- Lista de Aplicaciones → columna y filtro de **Categoría**

**Consejo**: Personalice las categorías para que coincidan con la terminología de su organización. Por ejemplo, renombre "Línea de negocio" a "Aplicaciones de negocio" si así las denomina su equipo.

### Clasificaciones y continuidad

Este editor configura los niveles utilizados para clasificar las aplicaciones, y las tecnologías en su pestaña Cumplimiento. Está disponible para usuarios `settings:admin` en la parte superior de la página y se abre como un único cuadro de diálogo con una lista por catálogo:

- **Criticidad de negocio**: los niveles que se pueden asignar a una aplicación. Cada nivel tiene un nombre, una descripción que se muestra bajo el nombre al elegir un nivel, una **duración máxima tolerable de interrupción (MTD)** opcional en minutos y una marca **Dejar de proponer**. La duración documenta el nivel y activa una advertencia en una aplicación cuyo RTO la alcanza; es un atributo del nivel, no un valor que se introduce en las aplicaciones.
- **Criticidad cibernética**: niveles de consecuencias independientes.
- **Confidencialidad de los datos**: el catálogo de clases de datos, con descripciones.
- **Olas de recuperación**: etapas ordenadas de restauración; el orden no representa gravedad ni duración.

**El orden es la posición en la lista.** Los catálogos de gravedad se listan del nivel más crítico arriba al menos crítico abajo; las olas de recuperación, en orden de restauración. Use las flechas para mover un nivel; la posición determina el orden de las listas, la regla del "nivel más alto" que usan interfaces y conexiones, y el orden de los selectores. **Añadir nivel** añade al final de la lista.

**Cambiar el catálogo nunca cambia las aplicaciones.** Una aplicación guarda el código de su nivel. Renombrar un nivel, editar su descripción o su duración y reordenar el catálogo dejan cada aplicación en el mismo nivel y no invalidan las revisiones. Un nivel que todavía usa una aplicación, interfaz o conexión no se puede eliminar; márquelo como **Dejar de proponer**: sigue visible en los registros existentes y ya no se propone para los nuevos.

Los códigos se generan a partir de los nombres y nunca se muestran; se aplican las reglas de nombres indicadas arriba.

Los niveles de negocio también alimentan la criticidad operativa de interfaces y conexiones. Las derivaciones incompletas se señalan como tales; no se tratan como el nivel más bajo.

#### Confidencialidad de los datos

La lista **Confidencialidad de los datos** contiene las clases de datos que usan las aplicaciones y las interfaces. Los niveles integrados (Público, Interno, Confidencial, Restringido) no pueden eliminarse ni marcarse como obsoletos.

**Dónde se usa**:
- Espacio de trabajo de Aplicaciones → pestaña Conformidad → campo **Clase de datos**
- Espacio de trabajo de Interfaces → pestaña Visión general → campo **Clase de datos**
- Lista de Aplicaciones → columna **Clase de datos**

### Patrones de integración

Patrones de integración utilizados por los segmentos de interfaz (p. ej., REST API, Lote de archivos, Cola, Staging BD).

**Columnas**: Nombre, Dejar de proponer

**Dónde se usa**:
- Segmentos de interfaz → campo **Patrón**

### Modos de autenticación de interfaz

Modos de autenticación de los segmentos y enlaces de interfaz (p. ej., Cuenta de servicio, OAuth2, Clave API, Certificado).

**Columnas**: Nombre, Dejar de proponer

**Dónde se usa**:
- Enlaces de interfaz → campo **Modo de autenticación**

### Categorías de datos de interfaz

Categorías de datos de negocio de las interfaces (p. ej., Datos maestros, Transaccional, Informes, Control).

**Columnas**: Nombre, Dejar de proponer

**Dónde se usa**:
- Espacio de trabajo de Interfaces → campo **Categoría de datos**

### Formatos de datos de interfaz

Formatos de datos de los segmentos de interfaz (p. ej., CSV, JSON, XML, IDoc, Binario).

**Columnas**: Nombre, Dejar de proponer

**Dónde se usa**:
- Segmentos de interfaz → campo **Formato de datos**

### Protocolos de interfaz

Protocolos admitidos para los enlaces de interfaz entre aplicaciones (p. ej., HTTP/REST, gRPC, SFTP, Kafka, Base de datos).

**Columnas**: Nombre, Dejar de proponer

**Dónde se usa**:
- Enlaces de interfaz → campo **Protocolo** (enlaces legado)

### Tipos de disparador de interfaz

Tipos de disparador de los segmentos de interfaz (p. ej., Basado en eventos, Programado, Tiempo real, Manual).

**Columnas**: Nombre, Dejar de proponer

**Dónde se usa**:
- Segmentos de interfaz → campo **Disparador**

### Estados del ciclo de vida

Opciones de ciclo de vida compartidas por aplicaciones, instancias de aplicación, interfaces, enlaces de interfaz y servidores.

**Columnas**: Nombre, Dejar de proponer

**Códigos bloqueados**: Los estados integrados (Propuesto, Activo, Obsoleto, Retirado) no pueden eliminarse ni tener sus códigos modificados.

**Dónde se usa**:
- Aplicaciones, Instancias de app, Interfaces, Enlaces de interfaz, Activos → campos de **Estado**

---

## Incidentes

### Categorías de incidente

Categorías utilizadas para clasificar las entradas del registro de incidentes.

**Columnas**: Nombre, Dejar de proponer

**Dónde se usa**:
- Incidentes → selector de **Categoría**

---

## Cómo afectan los cambios a los datos existentes

- **Los registros existentes conservan su valor** - Renombrar solo cambia lo que ven los usuarios, no los datos subyacentes.
- **Valores marcados como Dejar de proponer**:
  - Permanecen válidos para registros que ya los utilizan.
  - Se ocultan de los desplegables al crear nuevos registros.
  - Siguen apareciendo durante la edición si el registro ya usa ese valor.
- **Nuevos valores** están disponibles inmediatamente en los desplegables relevantes y se validan en el servidor.

Este enfoque le permite evolucionar su taxonomía con el tiempo sin romper los registros existentes.

---

## Referencia rápida: qué lista alimenta qué campo

| Lista | Dónde se usa |
|-------|--------------|
| **Métodos de acceso** | Aplicaciones (pestaña Técnico y soporte → Métodos de acceso) |
| **Categorías de aplicación** | Aplicaciones (Categoría) |
| **Zonas de administración** | Activos (panel de propiedades → Zona de administración), Tecnologías de la familia Directorio e identidad (panel de propiedades → Zona de administración), página Zonas de administración |
| **Proveedores cloud** | Activos (Proveedor), Ubicaciones (Proveedor cloud) |
| **Tipos de conexión** | Conexiones (Tipo de conexión) |
| **Dominios** | Activos (pestaña Técnico → Dominio, FQDN), página Zonas de administración |
| **Entidades** | Conexiones (Entidad de origen/destino), Mapa de conexiones (ubicación por nivel del grafo) |
| **Tipos de alojamiento** | Ubicaciones (Visión general), Tecnologías (Tipo de alojamiento) |
| **Patrones de integración** | Segmentos de interfaz (Patrón) |
| **Modos de autenticación de interfaz** | Enlaces de interfaz (Modo de autenticación) |
| **Categorías de datos de interfaz** | Interfaces (Categoría de datos) |
| **Formatos de datos de interfaz** | Segmentos de interfaz (Formato de datos) |
| **Protocolos de interfaz** | Enlaces de interfaz (Protocolo) |
| **Tipos de disparador de interfaz** | Segmentos de interfaz (Disparador) |
| **Categorías de incidente** | Incidentes (Categoría) |
| **Tipos de dirección IP** | Activos (pestaña Técnico → Direcciones IP → Tipo) |
| **Estados del ciclo de vida** | Aplicaciones, Instancias de app, Interfaces, Enlaces, Activos |
| **Zonas de red** | Subredes (Zona de red), Activos (auto-rellenado desde subred) |
| **Subredes** | Activos (pestaña Técnico → Direcciones IP → Selector de subred) |
| **Roles de servidor** | Aplicaciones → pestaña Servidores (rol al vincular activo a app), Mapa de conexiones (ubicación por nivel del grafo) |
| **Tipos de activo** | Activos (Visión general → Tipo) |
| **Familias de tecnologías** | Tecnologías (Familia), página Zonas de administración (servicios de directorio) |

---

## Consejos

- **Alinee los nombres con su terminología** - Revise los valores predeterminados y renombre los valores para que coincidan con cómo su organización habla de estos conceptos. Los registros conservan su vínculo con el valor; solo cambia el nombre.
- **Retire gradualmente** - Al dejar de usar un valor, márquelo como **Dejar de proponer** en lugar de eliminarlo. Esto mantiene los datos históricos intactos mientras dirige a los usuarios hacia nuevas opciones.
- **Coordine las Clases de datos con seguridad** - Los cambios en las Clases de datos deben alinearse con sus políticas de seguridad de la información. Consulte con conformidad antes de añadir o renombrar niveles de clasificación.
- **Use los puertos típicos como documentación** - El campo **Puertos típicos** de los tipos de conexión es informativo. Complételo para ayudar a los usuarios a entender qué puertos usa comúnmente cada tipo de conexión.
- **Ajuste la legibilidad del mapa con niveles** - Mantenga los niveles del grafo de las entidades y los roles de servidor alineados con sus capas de arquitectura (borde, aplicación, datos) para diseños más claros del Mapa de conexiones.
