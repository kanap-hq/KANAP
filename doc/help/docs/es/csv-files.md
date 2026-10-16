# Archivos CSV

Cada página de datos maestros tiene **Exportar CSV** e **Importar CSV** en su barra de herramientas, y documenta sus propias columnas. Esta página describe lo que esos archivos tienen en común. También se aplica a la lista de usuarios en **Administración**.

**Comprobar y después cargar.** Una importación tiene dos pasos. La **Verificación previa** lee el archivo e indica qué cambiaría una carga: las filas que se crearán, las que se actualizarán y las que no cambian nada. **Cargar** escribe el archivo. Antes no se escribe nada, y un archivo con un solo error no carga nada. Los errores nombran la fila del archivo tal como la muestra un editor de texto, incluidas las líneas vacías y las celdas que ocupan varias líneas.

**Las columnas se emparejan por su nombre**, en cualquier orden, sin distinguir mayúsculas y minúsculas, espacios ni guiones bajos. Estos archivos son estrictos: una columna que KANAP no conoce rechaza el archivo entero, y el mensaje, en una línea **Encabezado**, nombra las columnas desconocidas y las que faltan. El archivo de presupuesto es el que ignora las columnas que no conoce. Consulte [Cargar un presupuesto desde una hoja de cálculo](budget-file.md).

**Codificación y separador.** Guarde el archivo en UTF-8 ("CSV UTF-8" en Excel). Un archivo guardado por Excel como CSV simple, en Windows-1252, también se importa, acentos incluidos. El separador se lee en la fila de encabezados: `,`, `;` o un tabulador. La exportación escribe el separador del idioma en que se muestra la pantalla.

**Libros y otros archivos.** Una importación solo lee texto CSV. Un libro de Excel (`.xlsx`, `.xls`) o una hoja de cálculo OpenDocument (`.ods`) se rechaza antes de leer ninguna columna, con un mensaje que indica cómo guardarlo en CSV. En Excel: **Archivo › Guardar como › CSV UTF-8 (delimitado por comas)**. En LibreOffice Calc: **Archivo › Guardar como › Texto CSV**. Cualquier otro archivo que no sea texto se rechaza de la misma forma.

**Los importes, las fechas y los sí o no siguen el idioma de la pantalla** en la exportación, y una importación lee todas las formas:

| Idioma | Separador | Importes | Fechas | Sí, no |
|---|---|---|---|---|
| Inglés | `,` | `12280.50` | `2027-03-01` | `yes`, `no` |
| Francés | `;` | `12280,50` | `01/03/2027` | `oui`, `non` |
| Español | `;` | `12280,50` | `01/03/2027` | `sí`, `no` |
| Alemán | `;` | `12280,50` | `01.03.2027` | `ja`, `nein` |

Una fecha que el archivo no puede decidir por sí solo, como `01/03/2027`, se lee en el orden del idioma en que se muestra la pantalla: día primero en francés, alemán y español, mes primero en inglés. La verificación indica cómo ha leído el archivo, con un botón para cambiar la lectura. Una fecha con un día superior a 12 decide la cuestión por sí sola, y el archivo no guarda ninguna constancia del idioma en que se exportó.

Una importación lee sí o no en cualquiera de estos idiomas, y los `true`, `false`, `1` y `0` de los archivos anteriores. Los archivos de aplicaciones, activos, incidentes, proyectos, solicitudes y tareas siguen la misma tabla.

**Tamaño.** Un archivo contiene hasta 20.000 filas.
