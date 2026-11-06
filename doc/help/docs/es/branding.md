# Personalización

Use la página Personalización para aplicar la identidad de su empresa en KANAP. Aquí define el nombre de la organización, el logotipo y los colores principales, y el cambio es visible para todos los usuarios de su espacio de trabajo la próxima vez que recarguen la página.

## Dónde encontrarlo

- Espacio de trabajo: menú **Administración** → **Personalización**
- Ruta: `/admin/branding`
- Permiso: `users:admin`
- Disponible solo en hosts de espacio de trabajo (no en el host de administración de plataforma)

Los cambios se aplican únicamente a su espacio de trabajo actual.

## Qué puede personalizar

La página tiene tres tarjetas: **Nombre de la organización**, **Logotipo** y **Colores principales**. El logotipo y los colores son opcionales. Si no se establece nada, KANAP muestra su encabezado de texto e icono predeterminado y los colores de tema predeterminados.

- **Nombre de la organización**
  - El nombre que aparece con el logotipo, en Acerca de, en la página de consentimiento y para el asistente
  - De 1 a 120 caracteres
  - La dirección del espacio de trabajo sigue igual
- **Logotipo**
  - Aparece en la barra superior de la app (cuando ha iniciado sesión)
  - Aparece en el encabezado de la página de inicio de sesión
  - Un segundo logotipo opcional para el modo oscuro
- **Colores principales**
  - Un color principal para el **modo claro**
  - Un color principal para el **modo oscuro**
  - Utilizado por la barra de la app, los botones principales y los enlaces

## Nombre de la organización

1. Escriba el nombre.
2. Haga clic en **Guardar cambios**.

**Restablecer a valores predeterminados** deja el nombre como está. Quita los logotipos y los colores personalizados.

## Configuración del logotipo

### Archivos compatibles

- Formatos: `PNG`, `JPG/JPEG`, `GIF`, `WEBP`
- Tamaño máximo: `20 MB`

### Formato de logotipo recomendado

- Use un logotipo ancho y horizontal (preferiblemente con fondo transparente).
- Mantenga el contenido importante centrado: el área del encabezado es compacta.
- Para una representación nítida, use al menos unas 2× el tamaño mostrado (por ejemplo, `280x72` o superior).

### Cómo configurarlo

La tarjeta muestra una vista previa del encabezado claro y otra del encabezado oscuro, cada una con sus botones **Subir logo** y **Eliminar logo**.

1. Bajo la vista previa clara, haga clic en **Subir logo** y elija su archivo.
2. Si su logotipo se lee mal sobre un fondo oscuro (texto oscuro, por ejemplo), suba una segunda versión bajo la vista previa oscura.
3. Sin logotipo para el modo oscuro, **Usar el logo del modo claro** decide lo que muestra el modo oscuro: el logotipo del modo claro cuando está activado, el texto de marca predeterminado cuando está desactivado.
4. Compruebe ambas vistas previas y haga clic en **Guardar cambios** para publicar.

Para eliminar un logotipo, haga clic en **Eliminar logo** bajo su vista previa. El otro logotipo se mantiene.

El modo oscuro muestra el logotipo del modo oscuro cuando existe. El modo claro muestra siempre el logotipo del modo claro, o el texto de marca predeterminado si no hay ninguno. Los correos electrónicos usan siempre el logotipo del modo claro, ya que su fondo es claro.

## Configuración del color principal

Puede establecer colores para **Principal del modo claro** y **Principal del modo oscuro** de forma independiente. Cada selector de color ofrece cuatro formas de introducir un valor:

- Entrada hexadecimal (`#RRGGBB`)
- Un diálogo de selección de color (icono de paleta)
- Chips de paleta predefinida (una fila curada por modo)
- Una acción **Limpiar** para eliminar el valor personalizado

### Comportamiento claro/oscuro

- **Principal del modo claro** se utiliza en modo claro.
- **Principal del modo oscuro** se utiliza en modo oscuro.
- Si solo un modo tiene un color, KANAP reutiliza ese color en el otro modo como respaldo.
- Si ambos campos están vacíos, KANAP utiliza sus colores de tema predeterminados.

### Advertencia de contraste

Después de elegir los colores, la página evalúa qué tan legible es el texto sobre el fondo elegido. Si el contraste cae por debajo del umbral legible para cualquiera de los modos, aparece una advertencia informativa con la relación de contraste.

La advertencia es informativa (aún puede guardar), pero el contraste bajo suele significar texto blanco sobre un color pálido o texto oscuro sobre un color saturado, ambos cansan la vista en interfaces reales.

## Guardar y restablecer

Tres acciones en la parte inferior de la página controlan la persistencia:

- **Guardar cambios**: confirma el nombre de la organización, los logotipos seleccionados y los valores de color. Deshabilitado mientras no haya cambios pendientes, mientras el nombre esté vacío o supere los 120 caracteres, o mientras una entrada hexadecimal sea inválida.
- **Descartar**: revierte cualquier edición sin guardar en la página (no afecta a lo que ya está guardado).
- **Restablecer a valores predeterminados**: elimina los dos logotipos guardados y borra todos los colores personalizados. El nombre de la organización permanece. Pide confirmación antes de ejecutarse.

Una pequeña leyenda debajo de las acciones muestra el contador de **versión del logotipo**, que se incrementa cada vez que se sube o se elimina un logotipo. Esto es principalmente una indicación de que las cachés del navegador se actualizarán.

## Consejos

- **Pruebe en ambos temas**: cambie entre tema claro y oscuro antes de guardar: el mismo color de marca rara vez funciona en ambos modos.
- **Prefiera un fondo transparente**: los logotipos simples con fondo transparente proporcionan la representación más limpia del encabezado, especialmente en modo oscuro.
- **Use Restablecer de forma deliberada**: elimina tanto los logotipos como todos los colores personalizados de una sola vez. Úselo cuando empiece de nuevo, no como un "deshacer" para un único cambio. Para eso está **Descartar**.
- **Los colores de marca son para acentos**: KANAP utiliza el color principal en barras de la app, botones principales y enlaces. Elija algo que se lea limpiamente en tamaño de botón, no solo en un sitio de marketing.
