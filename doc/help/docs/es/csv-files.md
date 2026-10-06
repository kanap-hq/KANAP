# Archivos CSV

Cada página de datos maestros tiene **Exportar CSV** e **Importar CSV** en su barra de herramientas, y documenta sus propias columnas. Esta página describe lo que esos archivos tienen en común. También se aplica a la lista de usuarios en **Administración**.

**Comprobar y después cargar.** Una importación tiene dos pasos. La **Verificación previa** lee el archivo e indica qué cambiaría una carga: las filas que se crearán, las que se actualizarán y las que no cambian nada. **Cargar** escribe el archivo. Antes no se escribe nada, y un archivo con un solo error no carga nada. Los errores nombran la fila del archivo tal como la muestra un editor de texto, incluidas las líneas vacías y las celdas que ocupan varias líneas.

**Las columnas se emparejan por su nombre**, en cualquier orden, sin distinguir mayúsculas y minúsculas, espacios ni guiones bajos. Estos archivos son estrictos: una columna que KANAP no conoce rechaza el archivo entero, y el mensaje nombra las columnas desconocidas y las que faltan. El archivo de presupuesto es el que ignora las columnas que no conoce. Consulte [Cargar un presupuesto desde una hoja de cálculo](budget-file.md).

**Codificación y separador.** Guarde el archivo en UTF-8 ("CSV UTF-8" en Excel). Un archivo guardado por Excel como CSV simple, en Windows-1252, también se importa, acentos incluidos. El separador se lee en la fila de encabezados: `,`, `;` o un tabulador. La exportación escribe el separador del idioma en que se muestra la pantalla.

**Los importes y las fechas siguen el idioma de la pantalla** en la exportación, y una importación lee ambas formas:

| Idioma | Separador | Importes | Fechas |
|---|---|---|---|
| Inglés | `,` | `12280.50` | `2027-03-01` |
| Francés, español | `;` | `12280,50` | `01/03/2027` |
| Alemán | `;` | `12280,50` | `01.03.2027` |

Una fecha que el archivo no puede decidir por sí solo, como `01/03/2027`, se lee en el orden del idioma en que se muestra la pantalla: día primero en francés, alemán y español, mes primero en inglés. La verificación indica cómo ha leído el archivo, con un botón para cambiar la lectura. Una fecha con un día superior a 12 decide la cuestión por sí sola, y el archivo no guarda ninguna constancia del idioma en que se exportó.

**Tamaño.** Un archivo contiene hasta 20.000 filas.
