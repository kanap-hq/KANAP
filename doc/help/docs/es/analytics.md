# Dimensiones analíticas

Las Dimensiones analíticas ofrecen una forma flexible de clasificar y analizar su presupuesto IT fuera de su estructura contable formal. En lugar de reorganizar Empresas, Departamentos o Cuentas, puede crear categorías ligeras ("Infraestructura", "Migración a la nube", "Licencias") y etiquetar partidas de gasto para informes personalizados.

## Primeros pasos

Navegue a **Datos maestros > Dimensiones analíticas** para abrir la lista de categorías.

**Campos obligatorios**:
- **Nombre**: La etiqueta que aparece en los desplegables e informes. Debe ser única.

**Campos opcionales**:
- **Descripción**: Explique cuándo debe usarse esta categoría para que los compañeros la apliquen de manera consistente.

**Permisos**:
- Ver la lista: `analytics:reader`
- Crear o editar categorías: `analytics:member`

**Consejo**: Comience con 5--10 categorías amplias. Una nomenclatura consistente (todos sustantivos o todos gerundios) facilita la lectura de las listas.

## Trabajar con la lista

La lista de categorías proporciona una visión rápida de cada dimensión analítica en su espacio de trabajo.

**Columnas**:

| Columna | Qué muestra |
|---------|-------------|
| **Nombre** | Etiqueta de la categoría (se puede hacer clic: abre el espacio de trabajo) |
| **Descripción** | Breve explicación del propósito de la categoría |
| **Estado** | Habilitada o Deshabilitada |
| **Actualizado** | Marca de tiempo del último cambio |

**Filtrado**:
- Búsqueda rápida: busca en nombre y descripción
- Filtro de estado: limitar la lista a categorías Habilitadas o Deshabilitadas

**Acciones**:
- **Nueva categoría**: Crea una nueva dimensión analítica (requiere `analytics:member`)

## El espacio de trabajo de Dimensiones analíticas

Haga clic en cualquier fila para abrir el espacio de trabajo de esa categoría.

### Pestaña Visión general

Esta es la única pestaña. Contiene todos los campos de la categoría.

**Qué puede editar**:
- **Nombre**: La etiqueta de la categoría. Al cambiarla, se actualizan los desplegables e informes en todas partes.
- **Descripción**: Explicación de texto libre sobre el uso previsto de la categoría.
- **Ciclo de vida**: el interruptor de estado, cuya etiqueta muestra el estado actual (**Activado** o **Desactivado**), y la fecha de **Fin de validez**. Consulte [Estado y ciclo de vida](#estado-y-ciclo-de-vida).

**Navegación del espacio de trabajo**: Utilice los botones **Anterior** y **Siguiente** para recorrer las categorías sin volver a la lista. El espacio de trabajo conserva su contexto actual de ordenación, búsqueda y filtro. Si tiene cambios sin guardar, se le solicitará confirmación antes de navegar.

**Consejo**: Haga clic en el icono de cerrar (X) en la esquina superior derecha para volver a la lista con sus filtros intactos.

## Estado y ciclo de vida

Cada categoría tiene un estado (**Activado** o **Desactivado**) y un **Fin de validez** opcional. Permiten retirar una categoría sin eliminarla.

- **Fin de validez**: la fecha en que la categoría termina. Déjela en blanco para que la categoría permanezca activa indefinidamente. También puede programar una fecha futura.
- Si cambia la categoría a **Desactivado** sin fecha, el fin de validez se fija en hoy. Si la vuelve a **Activado**, la fecha se borra.
- Después del fin de validez, la categoría ya no aparece en los desplegables de selección para nuevos elementos.
- Los elementos existentes conservan su asignación y los informes históricos siguen siendo precisos.
- **Prefiera desactivar en lugar de eliminar**: no hay acción de eliminar en esta página. La desactivación preserva la continuidad de los informes manteniendo la lista limpia.

## Etiquetar partidas de gasto

Al crear o editar partidas OPEX o CAPEX:

1. Abra la pestaña **Visión general** de la partida de gasto.
2. Localice el campo **Categoría analítica**.
3. Seleccione una categoría del desplegable, o déjelo en blanco para "Sin asignar".
4. Guarde el elemento.

Puede cambiar o eliminar la categoría en cualquier momento. La categoría se aplica al elemento completo en todos los ejercicios fiscales.

## El informe de Dimensiones analíticas

El informe **Dimensiones analíticas** (en **Informes**) muestra cómo se reparte el presupuesto de sus partidas OPEX o CAPEX entre sus categorías. Consulte [Informes](reports.md) para la descripción completa.

**Características del informe**:
- **Tipo de partida**: OPEX o CAPEX
- **Rango de años**: Un solo año (gráfico circular o de barras) o varios años (gráfico de líneas)
- **Métrica**: Cualquier columna presupuestaria que muestre su organización, con su nombre. Empieza en la columna por defecto
- **Tipo de gráfico** (un solo año): Gráfico circular o gráfico de barras horizontal
- **Exclusión de categorías**: Filtrar categorías específicas para centrarse en un subconjunto

**Salidas del informe**:
- Gráfico visual de distribución presupuestaria
- Tabla resumen con totales por categoría y año
- Exportar a CSV (tabla), PNG (gráfico) o PDF (informe completo)

## Consejos

- **Mantenga la sencillez**: 5--10 categorías amplias suelen revelar más que docenas de etiquetas granulares.
- **Documente con descripciones**: Una breve descripción contribuye mucho a un uso consistente entre equipos.
- **No fuerce**: "Sin asignar" es un estado válido. Evite crear categorías genéricas vagas solo para llenar el vacío.
- **Desactive, no elimine**: Retirar una categoría preserva la precisión histórica en los informes.
- **Use informes para refinar**: Ejecute el Informe de Dimensiones analíticas periódicamente. Si una categoría captura demasiado o muy poco gasto, divídala o fusione en consecuencia.

## Preguntas frecuentes

**¿Puedo asignar varias dimensiones analíticas a un elemento?**
No. Cada partida de gasto tiene cero o una categoría. Para análisis multidimensional, considere combinar categorías o usar Departamentos con Asignaciones.

**¿Las dimensiones analíticas afectan a las asignaciones o la contabilidad?**
No. Son puramente para informes y no tienen impacto en las asignaciones de costes o la contabilidad formal.

**¿Cuántas categorías debo crear?**
Comience con 5--10. Más de 20 suele indicar sobreingeniería. Siempre puede dividir más adelante.

**¿Cuál es la diferencia entre dimensiones analíticas y departamentos?**
Los **Departamentos** son unidades organizativas formales con factores de asignación precisos. Las **Dimensiones analíticas** son etiquetas informales y opcionales para informes flexibles sin la sobrecarga de la asignación.

**¿Por qué algunos elementos muestran "Sin asignar"?**
Los elementos sin categoría analítica aparecen como "Sin asignar" en los informes. Esto es esperado: las categorías son totalmente opcionales.
