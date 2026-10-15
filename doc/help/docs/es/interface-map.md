# Mapa de interfaces

El Mapa de interfaces es una visualización interactiva de su panorama de integración de aplicaciones. Las aplicaciones aparecen como nodos y las interfaces como aristas conectoras, ofreciéndole una vista panorámica de cómo fluyen los datos entre sus sistemas para un entorno determinado.

## Dónde encontrarlo

Navegue a **Panorama IT > Mapa de interfaces** para abrir la visualización.

**Permisos**: Necesita al menos `applications:reader` para ver el mapa.

---

## Comprender la visualización

El mapa utiliza un diseño de grafo dirigido por fuerzas donde:

- **Nodos** representan aplicaciones
- **Aristas** representan interfaces entre aplicaciones
- **Etiquetas de aristas** muestran el identificador de la interfaz en cada conexión
- **El tamaño del nodo** refleja cuántas interfaces tocan la aplicación

### Vista de Negocio vs Técnica

Alterne entre los dos modos de vista con el conmutador **Mostrar middleware** en la barra de herramientas.

**Vista de negocio** (predeterminado, conmutador desactivado):

- Oculta las aplicaciones middleware
- Muestra relaciones directas origen-destino
- Mejor para comprender los flujos de datos de negocio

**Vista técnica** (conmutador activado):

- Muestra las plataformas middleware como nodos intermedios (renderizados como rombos)
- Expande cada interfaz a su ruta de datos real (Origen -> Middleware -> Destino)
- Mejor para comprender la arquitectura técnica

Una breve leyenda bajo el encabezado de la página le recuerda qué vista está activa.

---

## Filtros

Todos los filtros están en la barra de herramientas encima del mapa.

### Entorno

Filtrar interfaces por entorno de despliegue:

- Producción, Pre-Prod, QA, Test, Desarrollo, Sandbox

El predeterminado es **Producción**. Los enlaces mostrados en el panel lateral y las conexiones de infraestructura vinculadas siempre reflejan el entorno seleccionado.

### Ciclo de vida

Filtro de selección múltiple para el estado del ciclo de vida de la interfaz (Activa, Planificada, Obsoleta, etc.). Por defecto **Activa**.

### Aplicaciones

Centre el mapa en aplicaciones o servicios específicos:

1. Haga clic en el desplegable **Aplicaciones**
2. Elija una o más opciones (agrupadas en **Aplicaciones** y **Servicios de infraestructura**)
3. El mapa se filtra para mostrar solo las interfaces conectadas a su selección

Cuando elige al menos una aplicación aquí, el filtro **Profundidad** cambia automáticamente de **Todos** a **1** para que vea solo el vecindario inmediato.

### Profundidad

Limite cuántos saltos desde las aplicaciones seleccionadas se muestran:

- **Todos**: Mostrar cada nodo conectado (sin límite)
- **1-5**: Mostrar solo los nodos dentro de N saltos de las aplicaciones seleccionadas

Los nodos middleware no cuentan como un salto -- el contador de profundidad solo se incrementa al atravesar un nodo de aplicación principal.

Este filtro solo surte efecto cuando tiene al menos una aplicación seleccionada; sin selección el valor está bloqueado en **Todos**.

---

## Controles del grafo

El panel de control en el lado izquierdo del mapa proporciona estas herramientas:

| Icono | Acción | Descripción |
|-------|--------|-------------|
| Pausa / Reproducir | **Congelar / descongelar** | Pausar la simulación de fuerzas para posicionar nodos manualmente |
| Cruz | **Auto-centrar** | Alternar el centrado automático al seleccionar nodos (resaltado cuando está activado) |
| Zoom + | **Acercar** | Aumentar el nivel de zoom |
| Zoom - | **Alejar** | Disminuir el nivel de zoom |
| Cuadrícula | **Ajustar a la cuadrícula** | Alinear todos los nodos a una cuadrícula para diseños más limpios |
| SVG | **Exportar SVG** | Descargar la vista actual como imagen vectorial |
| PNG | **Exportar PNG** | Descargar la vista actual como imagen rasterizada |

Los botones de congelar y auto-centrar cambian de color cuando están activos para que pueda ver de un vistazo si están activados o desactivados. También puede hacer zoom con la rueda del ratón y desplazarse haciendo clic y arrastrando el fondo.

---

## Interactuar con el mapa

### Seleccionar nodos

Haga clic en un nodo de aplicación para resaltar sus conexiones y abrir un panel de detalle a la derecha.

### Seleccionar aristas

Haga clic en una arista de interfaz para ver los detalles de la interfaz en el panel lateral. Las aristas tienen un área de impacto invisible más amplia, por lo que no necesita hacer clic en la línea con precisión.

### Arrastrar nodos

Arrastre cualquier nodo para reposicionarlo manualmente. Mientras la simulación está en marcha, el diseño continúa ajustándose alrededor del nodo movido. Cuando la simulación está congelada, el nodo permanece exactamente donde lo coloca.

### Limpiar la selección

Haga clic en el fondo vacío del mapa (o en **Cerrar** en el panel lateral) para descartar el panel de detalle.

### Enlaces profundos

El mapa admite parámetros de URL para compartir vistas específicas:

| Parámetro | Descripción | Ejemplo |
|-----------|-------------|---------|
| `environment` | Preseleccionar un entorno | `prod`, `dev` |
| `lifecycles` | Preseleccionar filtros de ciclo de vida (separados por comas) | `active,planned` |
| `focusInterfaceId` | Resaltar una interfaz específica | UUID |
| `rootIds` | Preseleccionar aplicaciones en las que centrarse (separadas por comas) | UUIDs |
| `depth` | Establecer el límite de profundidad | `1`, `2`, `all` |

**Ejemplo**: `/it/interface-map?environment=prod&rootIds=abc123&depth=2`

---

## El panel de detalle

Cuando selecciona un nodo o una arista, se abre un panel lateral a la derecha con los detalles.

### Panel de aplicación

- **Descripción**: Qué hace la aplicación
- **Editor**: Editor del software
- **Criticidad**: Crítica para el negocio, Alta, Media o Baja
- **Servidores**: Servidores que alojan esta app, agrupados por entorno. Haga clic en el nombre de un servidor para abrir su espacio de trabajo.
- **Responsables de negocio** y **Responsables IT**: Contactos responsables
- **Información de soporte**: Contactos de soporte con sus roles. Haga clic en el nombre de un contacto para navegar a la pestaña Técnico de la aplicación.
- **Editar aplicación**: Abre el espacio de trabajo de la aplicación

### Panel de interfaz

Para la interfaz seleccionada y el entorno actual:

- **Criticidad**, **Ruta**, **Conteo de enlaces**, **Vía middleware** (sí/no)
- **Puntos finales**: Para cada enlace en el entorno activo, muestra app de origen -> app de destino, tipo de tramo, nombre de trabajo, punto final de origen y punto final de destino
- **Conexiones de infra**: Conexiones de infraestructura vinculadas a esta interfaz para el entorno actual. Cada tarjeta muestra origen, destino, protocolos y el entorno / tipo de tramo del enlace. Desde la tarjeta puede:
  - Hacer clic en **Editar** para abrir el espacio de trabajo de la conexión
  - Hacer clic en **Ver en el Mapa de conexiones** para saltar a la topología de infraestructura, prefocalizada en la conexión
- **Editar interfaz**: Abre el espacio de trabajo de la interfaz

---

## Consejos

- **Empiece con Producción**: Seleccione el entorno Prod para ver primero sus integraciones más críticas.
- **Centre en apps específicas**: Elija algunas apps en el filtro Aplicaciones y use profundidad 1 o 2 para explorar el vecindario de una aplicación sin todo el panorama.
- **Cambie a la vista Técnica**: Al diagnosticar problemas, active **Mostrar middleware** para ver la ruta de datos real a través de las plataformas de integración.
- **Exporte para documentación**: Use SVG para crear diagramas de arquitectura vectoriales, o PNG cuando necesite una imagen rasterizada.
- **Ajuste para mayor claridad**: Después de arrastrar nodos a su posición, use **Ajustar a la cuadrícula** para crear diseños más limpios y alineados.
- **Enlace profundo para compartir**: Copie la URL después de establecer filtros para compartir vistas específicas con sus colegas.
- **Cruce con el Mapa de conexiones**: Use **Ver en el Mapa de conexiones** en la sección Conexiones de infra para ver la topología de red subyacente de un enlace elegido.
