# Conexiones

Las Conexiones documentan las rutas de red a nivel de infraestructura entre servidores y entidades. Mientras que las Interfaces describen los flujos lógicos de datos entre aplicaciones, las Conexiones describen las rutas de red físicas -- qué servidores se comunican, a través de qué protocolos y puertos.

## Primeros pasos

Navegue a **Panorama IT > Conexiones** para ver su registro de conexiones. Haga clic en **Añadir conexión** para crear su primera entrada.

**Campos obligatorios**:
  - **ID de conexión**: Un identificador único (p. ej., `CONN-WEB-DB-001`)
  - **Nombre**: Un nombre descriptivo
  - **Tipo de conexión**: Servidor a servidor o Multi-servidor
  - **Origen** / **Destino**: Una entidad, clúster o servidor en cada extremo (para Servidor a servidor)
  - **Protocolos**: Al menos un protocolo de red

**Muy recomendados**:
  - **Propósito**: Por qué existe esta conexión
  - **Ciclo de vida**: Estado actual

**Consejo**: Las conexiones pueden vincularse a enlaces de interfaz para mostrar qué infraestructura soporta cada integración de aplicaciones.

---

## Trabajar con la lista

La lista proporciona una visión filtrable de todas las conexiones en su registro.

**Columnas predeterminadas**:
  - **ID de conexión**: Identificador único (haga clic para abrir el espacio de trabajo)
  - **Nombre**: Nombre de la conexión (haga clic para abrir el espacio de trabajo)
  - **Topología**: Servidor a servidor o Multi-servidor
  - **Origen** / **Destino**: Los puntos de conexión
  - **Protocolos**: Protocolos de red mostrados como chips
  - **Criticidad**: Importancia para el negocio -- puede derivarse de interfaces vinculadas
  - **Clase de datos**: Nivel de sensibilidad de los datos
  - **PII**: Si datos personales atraviesan esta conexión
  - **Riesgo**: Manual o Derivado (muestra el número de interfaces vinculadas)
  - **Ciclo de vida**: Estado actual
  - **Creado**: Cuándo se creó el registro

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
  - **Eliminar conexión**: Eliminar conexiones seleccionadas (requiere `infrastructure:admin`)

---

## Tipos de conexión

### Servidor a servidor

Una conexión directa entre dos puntos de conexión específicos. Cada lado puede ser un servidor, un clúster o una entidad con nombre:

- **Origen**: Donde se origina el tráfico -- seleccione un servidor, clúster o entidad
- **Destino**: Donde termina el tráfico -- mismas opciones
- No puede seleccionar tanto un servidor como una entidad para el mismo lado; elija uno u otro

Si un punto de conexión es un clúster, una nota le recordará que los hosts miembros se gestionan en el espacio de trabajo de Servidores.

### Multi-servidor

Una conexión que involucra múltiples servidores (p. ej., clústeres con balanceo de carga o topologías en malla):

- Seleccione al menos dos servidores del selector de **Servidores conectados**
- Utilice **Capas** para definir la ruta entre ellos

---

## El espacio de trabajo de Conexiones

Haga clic en cualquier fila para abrir el espacio de trabajo. Tiene cuatro pestañas: **Visión general**, **Capas**, **Criticidad y conformidad** e **Interfaces relacionadas**.

### Visión general

La pestaña Visión general captura la identidad y topología de la conexión.

**Qué puede editar**:
  - **ID de conexión**: Identificador único
  - **Nombre**: Nombre visible
  - **Propósito**: Por qué existe esta conexión (texto libre)
  - **Tipo de conexión**: Servidor a servidor o Multi-servidor
  - **Origen** / **Destino**: Para Servidor a servidor -- seleccione un servidor, clúster o entidad desde un desplegable agrupado
  - **Servidores conectados**: Para Multi-servidor -- busque y seleccione dos o más servidores
  - **Protocolos**: Uno o más protocolos de red (tomados de su configuración de Tipos de conexión)
  - **Ciclo de vida**: Estado actual
  - **Notas**: Contexto adicional

Cuando selecciona protocolos, el sistema muestra sus puertos típicos como referencia.

---

### Capas

La pestaña Capas le permite definir una ruta de red ordenada de hasta tres saltos -- útil para documentar proxies inversos, firewalls o enrutamiento intermedio.

**Qué captura cada capa**:
  - **Orden**: Número de secuencia (1 a 3)
  - **Nombre**: Una etiqueta para la capa (p. ej., `direct`, `reverse_proxy`, `firewall`)
  - **Origen** / **Destino**: Una entidad, clúster o servidor en cada extremo del salto
  - **Protocolos**: Qué protocolos se usan en esta capa
  - **Puerto personalizado**: Puerto personalizado si es diferente al predeterminado del protocolo (se autocompleta al seleccionar un protocolo)
  - **Notas**: Notas específicas de la capa

Las capas se guardan independientemente de la pestaña Visión general. Utilice el botón **Guardar capas** para persistir sus cambios.

**Consejo**: Debe guardar la conexión antes de poder añadir capas.

---

### Criticidad y conformidad

Esta pestaña controla la clasificación de riesgo y la configuración de protección de datos.

**Modo de riesgo**:
  - **Manual**: Usted establece la criticidad, clase de datos y PII directamente
  - **Derivado**: Los valores se agregan desde los enlaces de interfaz vinculados -- la pestaña muestra los valores efectivos y cuántos enlaces contribuyen

**Campos**:
  - **Criticidad**: Crítica para el negocio, Alta, Media o Baja
  - **Clase de datos**: Tomada de la configuración de clasificación de datos de su organización
  - **Contiene PII**: Si datos personales atraviesan la conexión

Cuando el modo de riesgo es Derivado, los campos de criticidad, clase de datos y PII son de solo lectura y reflejan los valores más altos de todas las interfaces vinculadas.

---

### Interfaces relacionadas

Esta pestaña muestra qué enlaces de interfaz están vinculados a esta conexión.

**Qué verá**:
  - **Interfaz**: Nombre y código, con chips de criticidad / clase de datos / PII
  - **Entorno**: Entorno del enlace y tipo de ruta
  - **Punto de conexión de origen** / **Punto de conexión de destino**: Los puntos de conexión del enlace
  - **Ciclo de vida**: Estado del ciclo de vida de la interfaz
  - **Acciones**: Un botón para navegar al espacio de trabajo de la interfaz

Esta pestaña es de solo lectura. Para vincular un enlace de interfaz a una conexión, utilice el espacio de trabajo de Interfaces o el Mapa de conexiones.

---

## Consejos

  - **Empiece por las rutas críticas**: Documente las conexiones de sus aplicaciones más importantes primero, luego trabaje hacia afuera.
  - **Use el modo de riesgo Derivado**: Deje que el sistema calcule la criticidad desde las interfaces que usan cada conexión -- ahorra esfuerzo y se mantiene actualizado a medida que las interfaces cambian.
  - **Vincule a interfaces**: Conectar su infraestructura a los enlaces de interfaz le da trazabilidad de extremo a extremo desde flujos de datos de aplicaciones hasta rutas de red.
  - **Documente protocolos con precisión**: Datos de protocolos precisos facilitan significativamente las revisiones de reglas de firewall y las auditorías de seguridad.
