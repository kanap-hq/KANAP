# Congelar datos maestros y copiar indicadores anuales

Dos herramientas de la [administración presupuestaria](budget-operations.md) gestionan los indicadores de empresas y departamentos a lo largo de los ejercicios fiscales: **Congelar datos maestros** y **Copiar indicadores anuales**. Úselas para bloquear cifras finalizadas, para trasladar una línea base a la planificación del próximo año o para comprobar qué está congelado y qué no.

Los indicadores anuales son la plantilla, los usuarios IT y la facturación de las empresas, y la plantilla de los departamentos. Son datos maestros, y el ciclo presupuestario los congela y los traslada de un año a otro. Por eso las dos herramientas están junto a las demás operaciones presupuestarias.

## Dónde encontrarla

- Espacio de trabajo: **Gestión presupuestaria**
- Ruta: **Gestión presupuestaria > Administración**, sección **Operaciones**, tarjetas **Congelar datos maestros** y **Copiar indicadores anuales**
- Permisos:
  - Abrir las páginas y ver el estado de congelación: el mismo acceso que el resto de la administración presupuestaria (por ejemplo, acceso de lector a OPEX)
  - Congelar / descongelar: `companies:admin`, `departments:admin` o `budget_ops:admin`
  - Copiar datos: `companies:admin`, `departments:admin` o `budget_ops:admin`

Los datos maestros no tienen una entrada de Administración propia.

---

## Congelar datos maestros

Utilice esta herramienta para bloquear o desbloquear métricas de empresas y departamentos para un año específico. La congelación previene ediciones accidentales después de que los datos hayan sido finalizados -- útil al cierre de año, durante auditorías o antes de iniciar el ciclo presupuestario del próximo año.

### Cómo funciona

1. Seleccione el **Año** que desea gestionar (el rango cubre el año anterior hasta cinco años adelante)
2. Marque los alcances sobre los que desea actuar: **Empresas**, **Departamentos** o ambos
3. Haga clic en **Congelar datos** para bloquear, o **Descongelar datos** para desbloquear

La página muestra una tarjeta de estado para cada alcance:

- **Congelado** (rojo) -- los datos son de solo lectura para ese año; la tarjeta muestra quién congeló y cuándo
- **Editable** -- los datos aún pueden modificarse

### Qué afecta la congelación

La congelación bloquea las métricas anuales en la pestaña **Detalles** de Empresas (plantilla, usuarios IT, facturación) o Departamentos (plantilla). No afecta:

- La pestaña Visión general (nombre, descripción y otros campos generales)
- Partidas OPEX o CAPEX

### Permisos

Necesita acceso de administrador en el alcance relevante para congelar o descongelar:

| Alcance | Permiso requerido |
|---------|-------------------|
| Empresas | `companies:admin` o `budget_ops:admin` |
| Departamentos | `departments:admin` o `budget_ops:admin` |

Si no tiene los permisos requeridos, la página aún le permite revisar el estado actual de congelación -- simplemente no puede cambiarlo.

---

## Copiar indicadores anuales

Copie métricas de empresas y departamentos de un ejercicio fiscal a otro. Una simulación integrada le permite previsualizar cada fila antes de confirmar, para que siempre sepa qué se sobrescribirá.

### Cómo funciona

1. Seleccione un **Año de origen** (de dónde leer los valores)
2. Seleccione **Fuentes de datos**: Empresas, Departamentos o ambos
3. Seleccione un **Año de destino** (dónde escribir los valores)
4. Si se selecciona Empresas, elija qué **Métricas de empresa** copiar -- cualquier combinación de Plantilla, Usuarios IT y Facturación
5. Haga clic en **Simulación** para generar una vista previa
6. Revise la tabla de vista previa
7. Haga clic en **Copiar datos** para aplicar los cambios

### Columnas de la tabla de vista previa

| Columna | Qué muestra |
|---------|-------------|
| **Tipo** | Empresa o Departamento |
| **Nombre** | Nombre de la entidad |
| **Métrica** | Plantilla, Usuarios IT o Facturación |
| **Valor de origen** | El valor del año de origen |
| **Destino actual** | El valor existente en el año de destino (si existe) |
| **Nuevo valor** | El valor que se escribirá -- mostrado en negrita |
| **Estado** | "Listo para copiar" o la razón por la que se omitió la fila |

Las filas omitidas aparecen en color de advertencia. Razones comunes de omisión:

- El valor de origen es nulo o vacío
- El año de destino está congelado para ese alcance
- La entidad no está activa para el año de destino

### Tarjetas de resumen

Debajo de la cuadrícula, cuatro tarjetas de resumen ofrecen un conteo rápido:

- **Total de filas** -- todo lo que la operación evaluó
- **Listas para copiar** -- filas que se escribirán
- **Omitidas** -- filas excluidas (con razones visibles en la tabla)
- **Errores** -- filas que fallaron durante la copia real

### Protección de datos congelados

No puede copiar datos a un año congelado. Si el año de destino está congelado para Empresas o Departamentos, aparece un banner de error y los botones de acción se deshabilitan. Descongele primero el año de destino con **Congelar datos maestros**.

### Exportación CSV

Puede exportar la tabla de vista previa a CSV usando el botón de exportación en la barra de herramientas. Esto es práctico para revisión fuera de línea o para compartir con colegas antes de confirmar. Esta exportación escribe la tabla tal como se muestra. Los archivos que importan las páginas de datos maestros se describen en [Archivos CSV](csv-files.md).

### Permisos

Se aplican las mismas reglas que para la congelación:

| Alcance | Permiso requerido |
|---------|-------------------|
| Empresas | `companies:admin` o `budget_ops:admin` |
| Departamentos | `departments:admin` o `budget_ops:admin` |

Si solo tiene acceso a un alcance, el otro está en gris en el selector de Fuentes de datos.

---

## Escenarios comunes

### Proteger datos finalizados de fin de año

Su presupuesto 2025 está aprobado. Bloquéelo para que nadie cambie accidentalmente las cifras.

1. Abra **Gestión presupuestaria > Administración > Congelar datos maestros**
2. Seleccione el año **2025**
3. Marque **Empresas** y **Departamentos**
4. Haga clic en **Congelar datos**

Todas las métricas de empresas y departamentos para 2025 son ahora de solo lectura hasta que las descongele.

### Inicializar el presupuesto del próximo año

Desea comenzar la planificación de 2026 usando la plantilla y facturación de 2025 como línea base.

1. Abra **Gestión presupuestaria > Administración > Copiar indicadores anuales**
2. Establezca **Año de origen** en **2025** y **Año de destino** en **2026**
3. En **Fuentes de datos**, seleccione **Empresas**
4. En **Métricas de empresa**, seleccione **Plantilla** y **Facturación** (deseleccione Usuarios IT si no lo necesita)
5. Haga clic en **Simulación** y revise la vista previa
6. Haga clic en **Copiar datos**

Todas las empresas ahora llevan la plantilla y facturación de 2025 a 2026. Ajuste los valores individuales según sea necesario.

### Corregir datos congelados

Congeló 2025 pero detectó un error en la plantilla de una empresa.

1. Abra **Gestión presupuestaria > Administración > Congelar datos maestros**
2. Seleccione el año **2025**, marque **Empresas** y haga clic en **Descongelar datos**
3. Edite la plantilla de la empresa en **Datos maestros > Empresas > Detalles**
4. Vuelva a **Congelar datos maestros** y vuelva a congelar Empresas 2025

---

## Preguntas frecuentes

**¿Qué pasa si intento editar un año congelado?**
La pestaña Detalles de Empresas o Departamentos se vuelve de solo lectura para ese año. Verá un mensaje indicando que los datos están congelados. Descongele para hacer cambios.

**¿La congelación afecta a las partidas OPEX o CAPEX?**
No. La congelación solo bloquea las métricas anuales (plantilla, usuarios IT, facturación) en Empresas y Departamentos. Las partidas OPEX y CAPEX no se ven afectadas.

**¿Puedo copiar datos a un año congelado?**
No. La herramienta de Copia mostrará un error y deshabilitará los botones de acción. Descongele primero el año de destino.

**¿Qué pasa si el destino ya tiene valores?**
La operación de copia los sobrescribe. Siempre ejecute una Simulación primero para ver la columna "Destino actual" y entender qué se reemplazará.

**¿Puedo deshacer una copia?**
No. Las operaciones de copia no son reversibles. Si necesita una red de seguridad, exporte los datos del año de destino a CSV antes de copiar.

**¿Por qué se omiten algunas filas?**
Las filas se omiten cuando el valor de origen es nulo, la entidad está inactiva para el año de destino o el destino está congelado. La columna Estado de la vista previa le indica qué razón aplica.

**¿Puedo copiar solo empresas o departamentos específicos?**
No. La herramienta copia todas las entidades para los alcances y métricas seleccionados. Para actualizaciones selectivas, utilice la exportación/importación CSV en las páginas individuales de Empresas o Departamentos.

**¿La copia crea nuevas empresas o departamentos?**
No. Solo escribe métricas para entidades que ya existen en ambos años. Si una empresa existe en el año de origen pero no en el de destino, esa fila se omite.

**¿Quién puede ver el estado de congelación?**
Cualquier persona que pueda abrir la administración presupuestaria. Solo los administradores del alcance relevante pueden realmente congelar o descongelar.

**¿Puedo congelar años futuros?**
Sí. El selector de año cubre un rango desde el año pasado hasta cinco años adelante. Congelar un año futuro es útil para bloquear presupuestos aprobados antes de que comience el ejercicio fiscal.

---

## Consejos

- **Siempre haga una simulación primero** -- revise la tabla de vista previa antes de confirmar para evitar sobrescrituras accidentales
- **Congele después de la aprobación** -- bloquee los datos tan pronto como los presupuestos se firmen para prevenir desviaciones
- **Descongele temporalmente** -- haga su corrección, luego vuelva a congelar inmediatamente
- **Copie temprano** -- inicie el próximo ciclo de planificación copiando las métricas del año actual hacia adelante, luego ajuste para los cambios esperados
- **Verifique sus permisos** -- si un alcance está en gris, solicite a un administrador que le otorgue el nivel de acceso adecuado
