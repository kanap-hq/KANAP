# Archivos CSV y Excel

Cada página de datos maestros tiene **Exportar** e **Importar** en su barra de herramientas, y documenta sus propias columnas. Esta página describe lo que esos archivos tienen en común. También se aplica a la lista de usuarios en **Administración**.

## Exportación

**Formato.** El diálogo de exportación ofrece **CSV** o **Excel (.xlsx)**. Su navegador recuerda la elección, que vale para cada diálogo y cada menú de exportación. El archivo contiene las filas que muestra la lista, con sus filtros y su búsqueda, salvo que pida todo el registro en el diálogo.

**Generado por Kadratis.** Kadratis escribe cada archivo de exportación, CSV o Excel, y lo anota en el [registro de auditoría](admin.md#registro-de-auditoria): quién exportó qué, con qué filtros, en qué formato y cuántas filas.

**Un archivo Excel** contiene una hoja con el nombre de la lista, con las mismas columnas que el CSV. La fila de encabezados está en negrita y queda fija al desplazarse, con un filtro en cada columna. Los números son números, los importes son exactos al céntimo, y las fechas son fechas que Excel y LibreOffice muestran en el orden de día y mes de su idioma. Cualquier otra celda es texto. Un texto que empieza como una fórmula sigue siendo texto.

## Importación

**Comprobar y después cargar.** Una importación tiene dos pasos. La **Verificación previa** lee el archivo e indica qué cambiaría una carga: las filas que se crearán, las que se actualizarán y las que no cambian nada. **Cargar** escribe el archivo y después el diálogo cuenta las filas creadas, actualizadas y sin cambios, por ejemplo «2 creadas, 5 actualizadas, 30 sin cambios». Un recuento de cero no se muestra. Antes de la carga no se escribe nada, y un archivo con un solo error no carga nada. Los errores nombran la línea del archivo tal como la muestra un editor de texto, incluidas las líneas en blanco y las celdas que ocupan varias líneas.

**Las columnas se emparejan por su nombre**, en cualquier orden, sin distinguir mayúsculas y minúsculas, espacios ni guiones bajos. Estos archivos son estrictos: una columna que Kadratis no conoce rechaza el archivo entero, y el mensaje, en una línea **Encabezado**, nombra las columnas desconocidas y las que faltan. El archivo de presupuesto es el que ignora las columnas que no conoce. Consulte [Cargar un presupuesto desde una hoja de cálculo](budget-file.md).

**Títulos de las columnas.** Los archivos de aplicaciones, activos, proyectos, incidentes, proveedores y contratos titulan sus columnas en el idioma de su pantalla, por ejemplo `Name` en inglés y `Nom` en francés. La importación lee estos títulos en cualquiera de los cuatro idiomas, y también los nombres técnicos que indican las páginas (`name`). Los demás archivos, incluido el archivo de presupuesto, usan los nombres técnicos.

**Libros de Excel.** Una importación lee un archivo CSV o un libro de Excel (`.xlsx`), con las mismas columnas y las mismas reglas. Kadratis solo lee la primera hoja. Cuando el libro tiene otras hojas, la verificación indica qué hoja leyó. Un número o una fecha introducidos como valor en una celda se leen tal cual, sin dudas sobre el separador ni el orden de día y mes, y una fecha con hora conserva su hora. Una fecha o un importe escritos como texto siguen las reglas de un archivo CSV que se describen más abajo. Un archivo antiguo de Excel (`.xls`) se rechaza con un mensaje: guárdelo como `.xlsx` o CSV. Las plantillas de importación son archivos CSV, que Excel abre.

**Codificación y separador de un archivo CSV.** Guarde el archivo en UTF-8 ("CSV UTF-8" en Excel). Un archivo guardado por Excel como CSV simple, en Windows-1252, también se importa, acentos incluidos. El separador se lee en la fila de encabezados: `,`, `;` o un tabulador. La exportación escribe el separador del idioma en que se muestra la pantalla.

**Otros archivos.** Una hoja de cálculo OpenDocument (`.ods`) se rechaza antes de leer ninguna columna, con un mensaje que indica cómo guardarla en CSV. En LibreOffice Calc: **Archivo › Guardar como › Texto CSV**, o **Excel 2007-365 (.xlsx)**. Cualquier otro archivo que no sea texto se rechaza de la misma forma.

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

**Tamaño.** Un archivo contiene hasta 20.000 filas.

En una instalación local, el administrador puede desactivar los libros de Excel en las importaciones. Los botones de importación muestran entonces **Importar CSV** y solo aceptan archivos CSV. Consulte [Configuración](on-premise/configuration.md#optional-excel-imports).
