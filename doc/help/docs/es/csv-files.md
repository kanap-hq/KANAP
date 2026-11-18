# Archivos CSV y Excel

Cada página de datos maestros tiene **Exportar** e **Importar** en su barra de herramientas, y documenta sus propias columnas. Esta página describe lo que esos archivos tienen en común. También se aplica a la lista de usuarios en **Administración**.

## Exportación

**Formato.** El diálogo de exportación ofrece **CSV** o **Excel (.xlsx)**. Su navegador recuerda la elección, que vale para cada diálogo y cada menú de exportación. El archivo contiene las filas que muestra la lista, con sus filtros y su búsqueda, salvo que pida todo el registro en el diálogo.

**Generado por Kadratis.** Kadratis escribe cada archivo de exportación, CSV o Excel, y lo anota en el [registro de auditoría](admin.md#registro-de-auditoria): quién exportó qué, con qué filtros, en qué formato y cuántas filas.

**Un archivo Excel** contiene una hoja con el nombre de la lista, con las mismas columnas que el CSV. La fila de encabezados está en negrita y queda fija al desplazarse, con un filtro en cada columna. Los números son números, los importes son exactos al céntimo, y las fechas son fechas que Excel y LibreOffice muestran en el orden de día y mes de su idioma. Cualquier otra celda es texto. Un texto que empieza como una fórmula sigue siendo texto.

## Importación

**Comprobar y después cargar.** Una importación tiene dos pasos. La **Verificación previa** lee el archivo e indica qué cambiaría una carga: las filas que se crearán, las que se actualizarán y las que no cambian nada. **Cargar** escribe el archivo y después el diálogo cuenta las filas creadas, actualizadas y sin cambios, por ejemplo «2 creadas, 5 actualizadas, 30 sin cambios». Un recuento de cero no se muestra. Antes de la carga no se escribe nada, y un archivo con un solo error no carga nada. Los errores nombran la línea del archivo tal como la muestra un editor de texto, incluidas las líneas en blanco y las celdas que ocupan varias líneas.

**Las columnas se emparejan por su nombre**, en cualquier orden, sin distinguir mayúsculas y minúsculas, espacios ni guiones bajos. Una columna que Kadratis no conoce rechaza el archivo entero, y el mensaje, en una línea **Encabezado**, la nombra. El archivo de presupuesto es el que ignora las columnas que no conoce. Consulte [Cargar un presupuesto desde una hoja de cálculo](budget-file.md).

**Referencias.** Los archivos de empresas, departamentos, proveedores y contactos empiezan con una columna `reference` opcional, que la exportación rellena (`COMP-12`, `DEPT-4`, `SUP-12`, `CTCT-4`). Una referencia rellenada designa el registro que la fila actualiza, aunque su nombre, o el correo electrónico de un contacto, haya cambiado. La verificación previa señala cada registro que cambiará de nombre o de empresa, y cada contacto que cambiará de dirección de correo electrónico. Vacía, la fila se empareja por su nombre, o un contacto por su correo electrónico. Una referencia que su espacio de trabajo no conoce rechaza la fila, como ocurre con un archivo exportado desde otro espacio de trabajo: vacíe la celda para importar la fila como un registro nuevo o por su nombre. Consulte [Empresas](companies.md#importacionexportacion-csv), [Departamentos](departments.md#importacionexportacion-csv), [Proveedores](suppliers.md#importacionexportacion-csv) y [Contactos](contacts.md#importacionexportacion-csv).

El archivo de contratos empieza con la misma columna `reference` opcional (`CTR-12`). Una referencia rellenada designa el contrato que la fila actualiza, aunque su nombre o su proveedor hayan cambiado, y la verificación previa señala cada contrato que cambiará de nombre o pasará a otro proveedor. Vacía, la fila se empareja por su nombre y su proveedor. Consulte [Contratos](contracts.md#csv-importexport).

**Títulos de las columnas.** Los archivos de aplicaciones, activos, proyectos, incidentes, proveedores y contratos titulan sus columnas en el idioma de su pantalla, por ejemplo `Name` en inglés y `Nom` en francés. La importación lee estos títulos en cualquiera de los cuatro idiomas, y también los nombres técnicos que indican las páginas (`name`). Los demás archivos, incluido el archivo de presupuesto, usan los nombres técnicos.

**Libros de Excel.** Una importación lee un archivo CSV o un libro de Excel (`.xlsx`), con las mismas columnas y las mismas reglas. Kadratis solo lee la primera hoja. Cuando el libro tiene otras hojas, la verificación indica qué hoja leyó. Un número o una fecha introducidos como valor en una celda se leen tal cual, sin dudas sobre el separador ni el orden de día y mes, y una fecha con hora conserva su hora. Una fecha o un importe escritos como texto siguen las reglas de un archivo CSV que se describen más abajo. Un archivo antiguo de Excel (`.xls`) se rechaza con un mensaje: guárdelo como `.xlsx` o CSV. Las plantillas de importación son archivos CSV, que Excel abre.

**Codificación y separador de un archivo CSV.** Guarde el archivo en UTF-8 ("CSV UTF-8" en Excel). Un archivo guardado por Excel como CSV simple, en Windows-1252, también se importa, acentos incluidos. El separador se lee en la fila de encabezados: `,`, `;` o un tabulador. La exportación escribe el separador del idioma en que se muestra la pantalla.

**Otros archivos.** Una hoja de cálculo OpenDocument (`.ods`) se rechaza antes de leer ninguna columna, con un mensaje que indica cómo guardarla en CSV. En LibreOffice Calc: **Archivo › Guardar como › Texto CSV**, o **Excel 2007-365 (.xlsx)**. Cualquier otro archivo que no sea texto se rechaza de la misma forma.

## Celdas vacías y `-` { #empty-cells-and-clearing }

Todas las importaciones leen sus celdas con la misma regla, desde el botón **Importar** de la lista o a través de Kad. El archivo de presupuesto y la lista de usuarios de **Administración** también la siguen:

- **Una celda vacía conserva el valor guardado.** Un `status` vacío conserva el estado guardado: no activa un registro desactivado.
- **`-` borra el valor guardado.** Una celda que solo contiene `-` es un borrado. Un texto como `Jean-Pierre` o un número como `-5` es un valor. La exportación escribe un `-` guardado como `'-`, que la importación lee como el texto `-`: un archivo exportado e importado de nuevo sin cambios no cambia nada. Para conservar un guion como valor, escriba `'-`. Una hoja de cálculo que guarda en CSV puede perder el apóstrofo: la verificación cuenta entonces ese guion entre los valores borrados.
- **Una celda con varios valores es la lista completa.** Reemplaza la lista guardada, por ejemplo los responsables de una aplicación o los clústeres de un servidor. `-` solo vacía la lista.
- **Una columna que el archivo omite nunca se escribe.** Un archivo puede contener solo las columnas que encuentran cada registro, como su referencia, su nombre o su código, y las columnas que se van a cambiar.
- **Algunos valores no se pueden borrar**: una referencia, un nombre u otra columna que encuentra el registro, un valor obligatorio, un estado y un sí o no. `-` en una de esas celdas rechaza la fila, y el mensaje nombra la columna. En un número que no puede quedar vacío, como la plantilla de una empresa o el importe anual de un contrato, el mensaje indica escribir `0`.
- **Fin de validez.** `-` en `disabled_at` borra la fecha, y el registro vuelve a estar activo. Una fila con `disabled` en `status` y `-` en `disabled_at` se rechaza: conserve uno u otro.
- **Registros nuevos.** Una celda obligatoria vacía rechaza la fila. `-` en un valor opcional lo deja vacío. Los valores predeterminados de un registro nuevo, como la duración de un contrato, solo se aplican al crearlo.
- **La verificación previa cuenta los borrados**, por ejemplo «Se borrarán 3 valores». El recuento incluye los valores que borra `-` y las entradas que quita una lista rellenada. Un `-` en un valor que ya está vacío no se cuenta. Un icono junto al título del diálogo de importación recuerda la regla.
- **Listas largas.** Una lista escrita en columnas numeradas, como `owner_email_1` a `owner_email_4`, ocupa tantas columnas como la lista más larga de la exportación, cuatro como mínimo. La importación las lee todas.

Cada página lista las columnas de su archivo y lo que hace `-` en ellas. Para el archivo de presupuesto, vea [Qué significa una celda](budget-file.md#que-significa-una-celda). Para Kad, vea [Importar una hoja de cálculo](ai-assistant.md#importar-una-hoja-de-calculo).

En el diálogo de importación de aplicaciones, activos, proyectos, solicitudes, tareas e incidentes, los tres ajustes predefinidos eligen si el archivo crea registros, los actualiza o ambas cosas.

## Nombres de registros { #names-of-records }

Una celda que nombra otro registro, como un proveedor, una empresa o un proyecto, lo encuentra en tres pasos:

1. el mismo nombre, escrito exactamente igual;
2. el mismo nombre con otras mayúsculas y minúsculas;
3. el mismo nombre con otros acentos, por ejemplo `Fromagerie Leger` para `Fromagerie Léger`.

El tercer paso solo vale para los registros que se encuentran por su nombre, en una lista que usted puede leer. Un correo, una referencia de ubicación como `LOC-4` o un código sigue los dos primeros pasos. Cuando varios registros responden al tercer paso, la fila se rechaza y el mensaje los nombra: escriba el nombre tal como está guardado.

**Asociaciones.** La verificación previa lista los nombres encontrados en el tercer paso bajo **N valores asociados**, plegados. Despliegue la línea para ver cada asociación, por ejemplo `Proveedor: Fromagerie Leger → Fromagerie Léger`. La lista también incluye las versiones encontradas por su etiqueta del catálogo (vea [Etiquetas de versión](technologies.md#version-labels)). **Deshacer** comprueba de nuevo el archivo sin esa asociación: el nombre se lee entonces como un nombre que Kadratis no conoce, y la carga mantiene esa elección. La asociación deshecha sigue en la lista con **Volver a asociar**, que comprueba de nuevo el archivo con ella. Las importaciones de aplicaciones, activos, proyectos, solicitudes, tareas, incidentes, contratos, contactos, centros de coste, procesos de negocio, vínculos de tecnologías y el archivo de presupuesto muestran esta lista.

**Un nombre que no se encuentra.** En las importaciones de aplicaciones, activos, proyectos, solicitudes, tareas e incidentes, una fila que actualiza un registro conserva el valor actual cuando una celda nombra un registro que Kadratis no encuentra. La verificación avisa: «No se encontró «X»: se conserva el valor actual.» Un valor que depende de otra columna solo se conserva si la fila deja esa columna sin cambios: la fase de una tarea con su proyecto, la línea con su categoría, el departamento con su empresa. Si no, el campo queda vacío y la verificación avisa. Una tarea conserva sus observadores, o sus responsables, cuando una de sus celdas nombra un correo desconocido. En un registro nuevo, el campo queda vacío y la verificación avisa. Una columna que exige un registro conocido rechaza la fila, como indica su página.

Las importaciones de Kad siguen las mismas reglas y muestran las asociaciones en su vista previa. Vea [Importar una hoja de cálculo](ai-assistant.md#importar-una-hoja-de-calculo).

## Archivos de ejemplo { #example-files }

El diálogo de importación de aplicaciones, activos, proyectos, proveedores, contratos y el archivo de presupuesto ofrece **Descargar un ejemplo**: un libro de Excel en el idioma de su pantalla.

- La primera hoja contiene algunos ejemplos de Fromage & Co con las columnas más usadas. Es la hoja que lee la importación.
- **Avanzado** muestra las demás columnas para las mismas filas, cuando la importación admite más de las que caben en la primera hoja. Para usar una, cópiela en la primera hoja.
- **Notas** indica qué admite cada columna. Las listas muestran los valores que acepta su espacio de trabajo, como sus categorías de aplicaciones o sus dimensiones analíticas.

Los nombres, códigos y correos electrónicos deben coincidir con registros de su espacio de trabajo. Los ejemplos usan los de los datos de ejemplo de Fromage & Co: sustitúyalos por los suyos, por ejemplo la ubicación de un servidor o la empresa de un contrato.

## Importes, fechas y sí o no

**En un archivo CSV, los importes, las fechas y los sí o no siguen el idioma de la pantalla** en la exportación, y una importación lee todas las formas:

| Idioma | Separador | Importes | Fechas | Sí, no |
|---|---|---|---|---|
| Inglés | `,` | `12280.50` | `2027-03-01` | `yes`, `no` |
| Francés | `;` | `12280,50` | `01/03/2027` | `oui`, `non` |
| Español | `;` | `12280,50` | `01/03/2027` | `sí`, `no` |
| Alemán | `;` | `12280,50` | `01.03.2027` | `ja`, `nein` |

**Las fechas** se escriben con el año primero (`2027-03-01`, `2027/03/01` o `2027.03.01`), o con el día y el mes antes del año (`01/03/2027`, `01.03.2027`). Una fecha escrita en letras, como `Mar 1 2027`, se rechaza, igual que un día que no existe en el calendario, como `31/02/2027`.

En las páginas de datos maestros, una fecha que el archivo no puede decidir por sí solo, como `01/03/2027`, se lee en el orden del idioma en que se muestra la pantalla: día primero en francés, alemán y español, mes primero en inglés. La verificación indica cómo ha leído el archivo, con un botón para cambiar la lectura. Una fecha con un día superior a 12 decide la cuestión por sí sola, y el archivo no guarda ninguna constancia del idioma en que se exportó. Los archivos de aplicaciones, activos, incidentes, proyectos, solicitudes y tareas siempre leen esa fecha con el día primero.

Una importación lee sí o no en cualquiera de estos idiomas, y los `true`, `false`, `1` y `0` de los archivos anteriores. Los archivos de aplicaciones, activos, incidentes, proyectos, solicitudes y tareas siguen la misma tabla, al igual que los archivos de vínculos de la lista de tecnologías. Consulte [Tecnologías](technologies.md#importar-y-exportar-vinculos).

**Estados, prioridades y gravedades.** Los archivos de proyectos, solicitudes, tareas e incidentes leen un estado, una prioridad o una gravedad por su nombre en cualquiera de los cuatro idiomas, como `On hold` o `Suspendu`, o por su código (`on_hold`). Un valor desconocido se rechaza, y el mensaje lista los nombres aceptados en el idioma de su pantalla.

**Tamaño.** Un archivo contiene hasta 20.000 filas.

En una instalación local, el administrador puede desactivar los libros de Excel en las importaciones. Los botones de importación muestran entonces **Importar CSV** y solo aceptan archivos CSV. Consulte [Configuración](on-premise/configuration.md#optional-excel-imports).
