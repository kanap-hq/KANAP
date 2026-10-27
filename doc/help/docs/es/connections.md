# Conexiones

Las Conexiones documentan las rutas de red a nivel de infraestructura entre servidores y entidades. Mientras que las Interfaces describen los flujos lógicos de datos entre aplicaciones, las Conexiones describen las rutas de red físicas: qué servidores se comunican, a través de qué protocolos y puertos.

## Primeros pasos

Navegue a **Panorama IT > Conexiones** para ver su registro de conexiones. Haga clic en **Añadir conexión** para crear su primera entrada.

**Campos obligatorios**:
  - **Nombre**: Un nombre descriptivo
  - **Topología**: Servidor a servidor o Multi-servidor
  - **Endpoints**: Un origen y un destino (Servidor a servidor), o al menos dos servidores (Multi-servidor)
  - **Protocolos**: Al menos un protocolo de red

KANAP da a cada conexión una referencia, por ejemplo `CONN-12`.

**Consejo**: Las conexiones pueden vincularse a enlaces de interfaz para mostrar qué infraestructura soporta cada integración de aplicaciones.

---

## Trabajar con la lista

La lista proporciona una visión filtrable de todas las conexiones en su registro.

**Columnas predeterminadas**:
  - **Referencia**: La referencia de la conexión, por ejemplo `CONN-12` (haga clic para abrir el espacio de trabajo)
  - **Nombre**: Nombre de la conexión (haga clic para abrir el espacio de trabajo)
  - **Topología**: Servidor a servidor o Multi-servidor
  - **Origen** / **Destino**: Los puntos de conexión
  - **Protocolos**: Protocolos de red mostrados como chips
  - **Criticidad**: Importancia para el negocio. Puede derivarse de interfaces vinculadas
  - **Clase de datos**: Nivel de sensibilidad de los datos
  - **PII**: Si datos personales atraviesan esta conexión
  - **Riesgo**: Manual o Derivado (muestra el número de interfaces vinculadas)
  - **Ciclo de vida**: Estado actual
  - **Creado el**: Cuándo se creó el registro

**Columnas adicionales** (mediante el selector de columnas):
  - **Servidores**: Conteo de servidores en una conexión multi-servidor

**Filtrado**:
  - Búsqueda rápida: Busca en los campos de conexión
  - Filtros de columna: **Topología**, **Ciclo de vida**, **Criticidad**, **Clase de datos** y **PII** usan listas de casillas, así que puede elegir varios valores a la vez. **Criticidad** y **Clase de datos** ofrecen también **(Vacío)** para las conexiones sin valor
  - **Criticidad**, **Clase de datos** y **PII** filtran y ordenan por el valor mostrado. En una conexión derivada, es el valor heredado de sus interfaces

**Ordenación**:
  - **Criticidad** y **Clase de datos** se ordenan por gravedad, en el orden de los niveles de [Clasificaciones y continuidad](it-ops-settings.md#clasificaciones-y-continuidad). Las conexiones sin valor van al final

**Acciones**:
  - **Añadir conexión**: Crear una nueva conexión (requiere `infrastructure:member`)
  - **Eliminar conexión**: Eliminar conexiones seleccionadas (requiere `infrastructure:admin`). Los saltos de cada conexión eliminada se eliminan con ella. Sus servidores, interfaces y documentos se conservan; solo se eliminan sus vínculos con la conexión. Para eliminar una sola conexión, ábrala y use **Eliminar** en su encabezado, lo que requiere `infrastructure:member` (consulte [El espacio de trabajo de Conexiones](#el-espacio-de-trabajo-de-conexiones)).

---

## Tipos de conexión { #connection-types }

### Servidor a servidor

Una conexión directa entre dos extremos. Cada lado es un servidor, un clúster o una entidad:

- **Origen**: Donde se origina el tráfico
- **Destino**: Donde termina el tráfico
- Un lado lleva un solo servidor, clúster o entidad
- El origen y el destino no pueden ser el mismo activo

### Multi-servidor

Una conexión entre varios servidores, por ejemplo una replicación entre nodos o una malla. Seleccione al menos dos servidores o clústeres.

### Conexiones en un clúster { #connections-on-a-cluster }

Un origen, un destino, un servidor de una conexión multi-servidor o el equipo de un salto puede ser un clúster. La conexión vale entonces para los miembros en servicio del clúster. Un miembro añadido más tarde también la recibe. Un miembro que sale del clúster la pierde. Un miembro retirado no recibe nada, y un clúster retirado no transmite nada.

Los selectores marcan un clúster con un icono y listan sus miembros bajo su nombre.

Cuando elige un servidor que pertenece a un clúster, KANAP pregunta **¿Conectar con el clúster?**. **Conectar con el clúster** pone el clúster en la conexión, para todos sus miembros. **Solo este servidor** mantiene el servidor. KANAP no pregunta cuando el otro lado ya es ese clúster o uno de sus miembros: la conexión se queda en el servidor.

Una lista multi-servidor que contiene un clúster y uno de sus miembros solo conserva el clúster. Un mensaje nombra los miembros quitados de la lista. Una lista debe conservar al menos dos servidores.

La pestaña [Red](assets.md#network) de cada miembro lista las conexiones de sus clústeres, y el [Mapa de conexiones](connection-map.md) dibuja los miembros de un clúster.

---

## El espacio de trabajo de Conexiones

Haga clic en una fila para abrir el espacio de trabajo. Tiene dos pestañas: **Vista general** y **Ruta**. El panel de propiedades de la derecha contiene **Ciclo de vida**, **Topología**, **Modo de riesgo**, **Criticidad**, **Clasificación de datos**, **Contiene PII** y **Creado el**. Los cambios se guardan automáticamente.

**Eliminar**, un icono de papelera en el encabezado, elimina la conexión tras una confirmación (`infrastructure:member`). La confirmación cuenta los saltos que se eliminan con ella y los enlaces de interfaz de los que se desvincula. Las interfaces se conservan.

### Vista general

- **Descripción**: Por qué existe esta conexión y qué transporta
- **Endpoints**: El origen y el destino, o los servidores de una conexión multi-servidor. Consulte [Tipos de conexión](#connection-types)
- **Protocolos**: Uno o varios protocolos de red, de su configuración de tipos de conexión, con sus puertos habituales
- **Derivación del riesgo**: En modo de riesgo derivado, las interfaces de las que viene el riesgo, con su criticidad, su clasificación de datos y su PII
- **Interfaces asociadas**: Los enlaces de interfaz vinculados a esta conexión. **Asociar existente** vincula otro

### Ruta

La pestaña Ruta documenta la ruta de red de la conexión, salto a salto: proxies inversos, cortafuegos, balanceadores de carga. Cree primero la conexión para añadir saltos.

Cada salto tiene:

  - Una función, por ejemplo Cortafuegos, Proxy inverso o Balanceador de carga
  - **Equipo**: Un servidor, un clúster o una entidad, o nada cuando el equipo no está documentado. Un servidor que pertenece a un clúster plantea la misma pregunta que un extremo. Consulte [Conexiones en un clúster](#connections-on-a-cluster)
  - **Protocolos (sustitución)** y **Puerto**: Cuando difieren de los de la conexión
  - **Notas**

**Añadir salto** añade un salto al final. Las flechas reordenan los saltos y la papelera quita uno. Cada cambio se guarda al instante.

### Riesgo

**Modo de riesgo**, en el panel de propiedades:

  - **Manual**: Usted fija directamente la criticidad, la clasificación de datos y la PII
  - **Derivado**: Los valores vienen de los enlaces de interfaz vinculados. Los campos son de solo lectura y muestran los valores más altos entre las interfaces vinculadas

**Criticidad** usa los niveles de [Clasificaciones y continuidad](it-ops-settings.md#clasificaciones-y-continuidad). Los niveles por defecto son Crítica, Alta, Moderada y Baja. **Clasificación de datos** viene de su configuración de clasificación de datos.

---

## Consejos

  - **Empiece por las rutas críticas**: Documente las conexiones de sus aplicaciones más importantes primero, luego trabaje hacia afuera.
  - **Use el modo de riesgo Derivado**: Deje que el sistema calcule la criticidad desde las interfaces que usan cada conexión. Ahorra esfuerzo y se mantiene actualizado a medida que las interfaces cambian.
  - **Vincule a interfaces**: Conectar su infraestructura a los enlaces de interfaz le da trazabilidad de extremo a extremo desde flujos de datos de aplicaciones hasta rutas de red.
  - **Documente protocolos con precisión**: Datos de protocolos precisos facilitan significativamente las revisiones de reglas de firewall y las auditorías de seguridad.
