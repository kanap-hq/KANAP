# Acceso a los datos

Los roles indican lo que una persona puede hacer en cada módulo. El acceso a los datos indica en qué parte del presupuesto puede hacerlo. Con él, el responsable de TI de una filial gestiona el presupuesto de esa filial sin ver el de las demás, y un director lee las líneas de sus propios centros de coste.

El acceso a los datos se aplica a las líneas presupuestarias (OPEX y CAPEX) y a los contratos, y a todo lo que los muestra: listas, totales, informes, búsqueda, Plaid, exportaciones. Los demás módulos funcionan como antes para todos.

Cada persona empieza con **Todos los datos**. Nada cambia mientras un administrador no limite a nadie.

## Dónde encontrarlo

- **La ventana del usuario**: abra un usuario desde **Administración > Usuarios** y elija la pestaña **Acceso a los datos**, junto a **Identidad**. La entrada **Acceso a los datos** del menú de una fila abre la ventana en esa pestaña.
- **Administración > Acceso a los datos**: la lista de las personas cuyo acceso está limitado, con la importación y la exportación.
- **La pestaña Acceso** de una empresa y de un centro de coste o grupo: quién lo ve, y mediante qué nodo.

Permisos: estas pantallas requieren el nivel Admin en usuarios (`users:admin`), y todos los datos para usted. No puede cambiar su propio acceso.

## Todos los datos o limitado a

Una persona está en uno de estos dos modos:

- **Todos los datos**: la persona ve todo el presupuesto y todos los contratos, según lo que permitan sus roles. Es el modo por defecto.
- **Limitado a**: la persona ve lo que cubre una lista de nodos. Cada nodo tiene un acceso, **Lectura** o **Edición**.

Un nodo es uno de estos:

| Nodo | Lo que cubre |
|---|---|
| Una empresa | Las líneas que paga la empresa, las líneas imputadas a sus centros de coste, y sus contratos |
| Un grupo de centros de coste | Sus subgrupos y los centros de coste de estos, sea cual sea su empresa |
| Un centro de coste | Las líneas imputadas a él |
| **Todo** | Todas las líneas y todos los contratos |

Una línea es visible cuando la paga una empresa de la lista, o cuando está imputada a un centro de coste situado bajo un nodo de la lista. Un contrato es visible cuando su empresa está en la lista, o cuando su campo **Centro de coste o grupo** apunta bajo un nodo de la lista. Ese campo es opcional, y la lista de contratos tiene una columna y un filtro **Sin centro de coste** para completarlo.

Un ejemplo. El espacio de trabajo tiene dos empresas, Alpha France y Alpha Spain, y un grupo Infraestructura que contiene INF-FR (Francia) e INF-ES (España).

- Marta, limitada a **Alpha Spain (Edición)**, ve y modifica las líneas que paga Alpha Spain.
- Paul, limitado a **Infraestructura (Lectura)**, lee las líneas imputadas a INF-FR e INF-ES. Una línea española sin centro de coste le queda oculta.
- Claire, con **Todos los datos**, lo ve todo.

**Todo** sirve a las personas que leen todo el presupuesto y modifican una parte: deles **Todo (Lectura)** más los nodos que modifican.

Los nodos se suman. Cuando dos nodos cubren la misma línea, prevalece el acceso más amplio: con Redes en Lectura y RED-01 en Edición, las líneas de RED-01 son editables y el resto de Redes es de solo lectura. Un nodo no puede excluir uno de sus subnodos.

### Crear y mover una línea o un contrato

Para crear una línea, o cambiar su empresa o su centro de coste, la empresa debe corresponder a un nodo en Edición:

- la empresa que paga es una empresa en Edición, o
- el centro de coste de la línea está cubierto en Edición y la línea la paga la empresa de ese centro.

Un nodo de centro de coste permite, por tanto, crear las líneas de ese centro pagadas por su empresa. No permite hacer pagar a otra empresa. Una línea pagada por una empresa distinta de la de su centro de coste se lee por el centro de coste y solo se modifica por su empresa pagadora.

Los contratos siguen la misma regla con su empresa y su **Centro de coste o grupo**. Los selectores de empresa y de centro de coste solo ofrecen los valores que la persona puede usar. Otro valor se rechaza con «Esta empresa o este centro de coste no forma parte de su acceso.»

### Líneas sin empresa

Las líneas antiguas pueden no tener empresa. Solo las ven las personas con todos los datos, las personas con un nodo **Todo** y las personas nombradas en ellas. **Administración > Acceso a los datos** las cuenta, con un enlace a la lista.

## El rol dice qué, los nodos dicen dónde

Ambos funcionan juntos:

- **Edición** da lo que permiten los roles de la persona. Un Lector de presupuesto con un nodo en Edición sigue solo leyendo.
- **Lectura** limita el acceso a la lectura, sean cuales sean los roles.
- El acceso a los datos pertenece a la persona. Se aplica al presupuesto y a los contratos con el nivel que cada rol da en cada módulo.

Por ejemplo, un Miembro de presupuesto limitado a **Alpha Spain (Edición)** crea y modifica líneas españolas. Un Lector de presupuesto con el mismo nodo las lee.

## Lo que una persona ve siempre

Una persona limitada ve siempre aquello en lo que está nombrada, incluso fuera de sus nodos:

| Nombrada como | Acceso, dentro del rol |
|---|---|
| Responsable de TI o responsable de negocio de una línea | Edición |
| Responsable de un contrato | Edición |
| Persona asignada o responsable de una tarea | Edición |
| Persona que sigue una tarea | Lectura |

Crear una tarea no cuenta. Estar nombrada abre el elemento. No permite situarlo en una empresa o un centro de coste fuera de sus nodos en Edición, ni eliminarlo. Un cambio que sacaría una línea del acceso de la persona se rechaza con «Este cambio sacaría la línea de su acceso. Siga siendo uno de sus responsables, o pídaselo a alguien con acceso a su empresa.»

Una persona limitada sin nodos solo ve aquello en lo que está nombrada. Una lista vacía nunca vuelve a ser todos los datos.

El responsable del presupuesto de un centro de coste no está nombrado en sus líneas. Para dar a los responsables del presupuesto sus centros, use **Añadir sus centros** en la ventana del usuario (ver más abajo).

## Administradores

El rol Administrador ve siempre todos los datos. Su pestaña **Acceso a los datos** muestra «Los administradores ven todos los datos.» y no tiene controles.

Cuando una persona limitada recibe el rol Administrador, su acceso guardado se mantiene y no tiene efecto. Si más tarde se le retira el rol, el acceso guardado vuelve a aplicarse.

## Configurar el acceso de una persona

La pestaña **Acceso a los datos** de la ventana del usuario contiene:

- **Todos los datos** y **Limitado a**.
- Bajo **Limitado a**, los nodos, cada uno con su tipo, un selector **Lectura** o **Edición** y un botón para quitarlo.
- **Añadir**, que abre un selector en tres secciones: **Empresas**, **Centros de coste** (grupos y centros, en árbol) y **Todo**. Sin centros de coste en el espacio de trabajo, el selector ofrece las empresas y **Todo**.
- **Añadir sus centros (3)**, cuando la persona es responsable del presupuesto de centros de coste. Añade esos centros en Edición.
- Dos recordatorios: «Esta persona también ve siempre aquello en lo que está nombrada.» y «Se aplica al presupuesto y a los contratos.»
- La vista previa, por ejemplo «Con este acceso: 312 líneas presupuestarias, 280 en edición; 45 contratos.»
- Quién cambió el acceso por última vez, y cuándo.

La vista previa sigue cada cambio, antes de guardar. Mide los nodos, no los roles: **en edición** cuenta las líneas abiertas en Edición, aunque los roles de la persona no le permitan modificarlas.

Volver a **Todos los datos** pide una confirmación, por ejemplo «Marta Ruiz verá todos los datos del presupuesto y de los contratos.»

Un solo **Guardar** escribe toda la ventana: la pestaña de identidad y después el acceso. Cuando algo se rechaza, el mensaje aparece en su pestaña y la ventana sigue abierta.

## La página Acceso a los datos

**Administración > Acceso a los datos** lista todas las personas limitadas, incluidas las que no tienen nodos:

| Columna | Contenido |
|---|---|
| **Persona** | El nombre. Haga clic en él para abrir la ventana del usuario en su pestaña **Acceso a los datos** |
| **Roles** | Los roles de la persona |
| **Nodos** | Cada nodo con su acceso, o **Ninguno** |
| **Última modificación** | Quién cambió el acceso por última vez, y cuándo |

- **Buscar un nombre** filtra por nombre.
- **Quién tiene acceso a…** filtra por una empresa o un centro de coste: la lista conserva las personas cuyos nodos lo cubren.
- Encima de la lista, dos contadores: las personas limitadas y las líneas presupuestarias sin empresa, con un enlace a esas líneas.

Las personas con **Todos los datos** no aparecen.

En **Administración > Usuarios**, aparece una columna **Acceso** en cuanto alguien está limitado. Muestra **Todos los datos**, los nombres de los nodos de la persona (**Todo** para ese nodo), o **Ninguno** para una persona limitada sin nodos.

## La pestaña Acceso de empresas y centros de coste { #the-access-tab-of-companies-and-cost-centers }

Las empresas y los centros de coste tienen una pestaña **Acceso**, para las mismas personas que gestionan el acceso a los datos.

En una empresa:

- **Ven toda la empresa**: las personas con un nodo en la empresa, o con **Todo**. **Añadir** da esta empresa a una persona en Lectura o en Edición.
- **Ven una parte**: las personas que llegan a algunas de sus líneas mediante un grupo o un centro de coste de la empresa, con el nodo que da el acceso. Por ejemplo, en Alpha Spain: Paul, mediante Infraestructura.

En un centro de coste o un grupo:

- **Acceso directo**: las personas con un nodo en este centro o grupo. **Añadir** da este nodo a una persona en Lectura o en Edición.
- **Acceso heredado**: las personas que llegan a él mediante un grupo padre, la empresa del centro, o **Todo**. La columna **Mediante** enlaza al nodo que da el acceso. Cambie un acceso heredado en ese nodo.

Los cambios en estas pestañas se guardan al momento. Si la persona añadida tiene todos los datos, una confirmación indica que su acceso pasará a ese único nodo. **Cancelar** lo deja como estaba.

## Importación y exportación

**Importar** y **Exportar**, en **Administración > Acceso a los datos**, trasladan el acceso de muchas personas a la vez, en un archivo CSV o un libro de Excel (`.xlsx`). Consulte [Archivos CSV y Excel](csv-files.md). Un archivo contiene una fila por persona y por nodo:

| Columna | Contenido |
|---|---|
| `email` | La dirección de correo de la persona |
| `type` | `company`, `cost_center` o `all` |
| `node` | Una empresa por su nombre, un centro de coste o un grupo por su código. Vacío para `all` |
| `access` | `read` o `edit` |

Por ejemplo:

```text
email;type;node;access
marta.ruiz@example.com;company;Alpha Spain;edit
paul.martin@example.com;cost_center;INF;read
claire.dubois@example.com;all;;read
```

- Una persona presente en el archivo recibe exactamente los nodos listados para ella, en **Limitado a**. Una persona ausente del archivo no cambia.
- Una importación siempre limita. Para devolver todos los datos a alguien, use la ventana del usuario.
- La comprobación va primero y no escribe nada. Indica cada fila rechazada: persona desconocida, empresa o centro de coste desconocido, tipo o acceso no válido, un nodo listado dos veces para una misma persona, un Administrador, su propia cuenta. Un archivo con un error no carga nada.
- La exportación escribe el mismo formato, para las personas limitadas. Una persona limitada sin nodos no tiene fila, de modo que volver a importar el archivo la deja como está.

El separador, la codificación y los dos pasos de la importación son los de todos los archivos CSV: vea [Archivos CSV y Excel](csv-files.md).

## Registro de auditoría { #audit-log }

Cada cambio del acceso de una persona queda registrado en el [Registro de auditoría](admin.md#registro-de-auditoria), en la tabla **Acceso a los datos**. La entrada nombra a la persona y muestra el modo, los nodos y su acceso antes y después. Su origen es **Pantalla** o **Importación**. Un guardado sin cambios no se registra.

## Preguntar al asistente

[Plaid](ai-assistant.md#tool-calls) lee esta página y la pestaña Acceso de las empresas para un administrador de usuarios con acceso a todos los datos. Pregunte, por ejemplo: «¿Quién está limitado a Alpha Spain?», «¿Qué personas limitadas no tienen ningún nodo?» o «¿Qué puede ver Marta Ruiz?» Los cambios en el acceso de una persona se quedan en las pantallas descritas aquí.

## Lo que ve una persona limitada { #what-a-limited-person-sees }

Para una persona limitada, el presupuesto y los contratos solo contienen lo que cubre su acceso.

**Listas, totales e informes** cuentan solo las líneas visibles. Una línea está entera o ausente. No hay total del grupo.

**Solo lectura.** Una línea o un contrato visible en Lectura muestra «Solo lectura en su acceso» arriba, sin comandos de edición.

**Enlaces a elementos ocultos.**

- Una línea oculta aparece solo por su referencia, como `BL-12`, sin enlace.
- Un contrato oculto aparece como «Contrato fuera de su acceso», sin enlace.
- Las listas de enlaces (las líneas de un contrato, una aplicación, un servidor, una tecnología, un proyecto o una solicitud) muestran los enlaces visibles y después un número como «y 3 líneas fuera de su acceso». Ni nombre, ni importe.
- El contrato de una línea visible se abre en solo lectura. Sus adjuntos y enlaces documentales siguen cerrados, con un número como «2 adjuntos, reservados a las personas que ven este contrato».
- La búsqueda, Plaid, MCP y las exportaciones no muestran ningún rastro de un elemento oculto.

Estos números aparecen para las personas que leen el presupuesto pero no esas líneas. Una persona sin el derecho de presupuesto no ve ninguna línea presupuestaria en los paneles de aplicaciones, servidores y proyectos, ni ningún número.

**Las cifras de un elemento visible** abarcan todos sus datos. La cobertura de un contrato cuenta todas sus líneas vinculadas, también las ocultas, para que su responsable vea la cobertura real. Vea [Contratos](contracts.md#compromiso-y-cobertura).

**Eliminar un elemento con enlaces ocultos** (una aplicación, un servidor, una tecnología, un proyecto, una solicitud) se rechaza, por ejemplo «Esta aplicación está vinculada a 3 líneas fuera de su acceso.» Una persona que ve esas líneas puede eliminarlo.

**Las tareas** de una línea o de un contrato lo siguen: la persona las ve cuando ve la línea o el contrato, o cuando está nombrada en la tarea.

**El archivo de presupuesto**, para una persona cuyo rol lo permite, sigue las mismas reglas fila por fila. Vea [Cargar un presupuesto desde una hoja de cálculo](budget-file.md#limited-data-access).

**Dimensiones con valores abiertos.** En una dimensión marcada **Valores abiertos**, cualquier persona que puede editar una línea añade un valor desde la línea o el archivo de presupuesto. En las demás dimensiones, los valores se crean en la página Dimensiones analíticas, por personas con todos los datos. Vea [Dimensiones analíticas](analytics.md#open-values).

**Contracargo.** El contracargo por empresa se abre en las empresas de los nodos de empresa de la persona (todas con **Todo**). Muestra la parte imputada a esas empresas, línea por línea: referencia, etiqueta, empresa que paga, método, porcentaje, importe, y los departamentos cuando la asignación llega a ellos. Una línea que la persona no ve de otro modo muestra su referencia y su etiqueta sin enlace. Las cifras de las demás empresas y los totales del grupo se omiten. El contracargo global muestra las líneas visibles. Un nodo de centro de coste no abre el contracargo de una empresa. Vea [Informes](reports.md#contracargo-por-empresa).

### Reservado a las personas con todos los datos

Aunque sus roles lo permitan, una persona limitada no puede:

- cambiar la configuración del espacio de trabajo: congelar y descongelar, la regla de asignación por defecto, las columnas del presupuesto, las divisas, la copia anual de los datos maestros, la plantilla y los indicadores de empresas y departamentos;
- ejecutar operaciones sobre muchas líneas: copiar y restablecer columnas de presupuesto, copiar asignaciones, eliminar en bloque;
- eliminar una línea o un contrato;
- gestionar personas: usuarios, roles, acceso a los datos, registro de auditoría;
- modificar los datos de organización: empresas, departamentos, centros de coste, cuentas y planes de cuentas, procesos de negocio, las propias dimensiones y los valores de las dimensiones sin valores abiertos;
- modificar o eliminar un proveedor o un contacto compartido (puede crearlos, según su rol);
- importar proveedores, contactos, contratos o tareas;
- usar las pantallas de los agentes de IA;
- cambiar la configuración de los contratos, la personalización y las tareas programadas.

Los controles que acompañan a estas operaciones (las vistas previas de impacto, la comprobación antes de una eliminación) también están reservados. Esos comandos están ocultos. Una petición que llega de todos modos al servidor se rechaza con «Esta acción está reservada a las personas con acceso a todos los datos.» Una persona con un rol de administración del presupuesto conserva el archivo de presupuesto dentro de su acceso.

## Cuando el acceso a los datos no está disponible

Limitar el acceso a los datos requiere un paso único en el servidor de base de datos. Mientras no se haya hecho, **Limitado a** aparece en gris en la ventana del usuario, con «Limitar el acceso a los datos requiere un paso único en la base de datos, realizado por la persona que gestiona KANAP.» y un enlace a esta página. **Administración > Acceso a los datos** muestra el mismo mensaje, con lo que falta.

En instalaciones locales, el paso está en la guía de instalación: [Acceso a los datos por ámbito](on-premise/installation.md#optional-data-scoped-access).

Si el paso se deshace más tarde, por ejemplo tras restaurar una base en otro servidor, las personas limitadas se rechazan con «El acceso a los datos no está disponible temporalmente. Contacte con la persona que administra KANAP.» Las personas con todos los datos siguen trabajando. Repetir el paso y reiniciar la API devuelve el acceso a las personas limitadas. Vea [Copia de seguridad y restauración](on-premise/operations.md#restauracion).
