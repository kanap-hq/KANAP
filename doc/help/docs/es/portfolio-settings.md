# Configuración del portafolio

La Configuración del portafolio le permite configurar el sistema de evaluación, las competencias del equipo, las plantillas de fases de proyecto, la estructura de clasificación y los tipos de contrato utilizados en todas las solicitudes y proyectos del portafolio. Estas configuraciones determinan cómo se evalúan las solicitudes, cómo se estructuran los proyectos y cómo se categorizan los elementos.

## Dónde encontrarlo

- Espacio de trabajo: **Portafolio**
- Ruta: **Portafolio > Configuración**
- Permisos:
  - Necesita `portfolio_settings:admin` para modificar la configuración
  - Los niveles de permiso inferiores pueden ver pero no editar

Si no ve Configuración en el menú, solicite a su administrador que le otorgue los permisos apropiados.

## Criterios de evaluación

Defina los criterios de evaluación utilizados para calcular las puntuaciones de prioridad de solicitudes y proyectos.

### Configuración de omisión obligatoria

En la parte superior de la pestaña Criterios de evaluación:
- **Las solicitudes obligatorias obtienen automáticamente 100 puntos**: Cuando está habilitado, cualquier solicitud con un valor de criterio marcado como "obligatorio" recibe una puntuación de prioridad de 100 independientemente de otros criterios

### Gestión de criterios

Cada criterio tiene:
  - **Nombre**: Qué está evaluando (p. ej., "Alineación estratégica", "Nivel de riesgo")
  - **Peso**: Importancia relativa (mayor peso = más impacto en la puntuación)
  - **Invertido**: Si está marcado, el primer valor = puntuación más alta en lugar de más baja
  - **Habilitado/Deshabilitado**: Alternar para incluir en la evaluación o no
  - **Valores**: Las opciones de escala en orden

**Para añadir un criterio**:
1. Haga clic en **Añadir criterio**
2. Introduzca el nombre
3. Establezca el peso (predeterminado es 1)
4. Marque "Invertido" si una posición más alta debe significar puntuación más baja
5. Defina los valores en orden (mínimo 2)
6. Opcionalmente marque un valor como "Obligatorio" (activa la omisión)
7. Haga clic en **Guardar**

**Para editar un criterio**:
- Haga clic en el icono de editar
- Modifique nombre, peso, inversión o valores
- Haga clic en **Guardar**

**Para eliminar un criterio**:
- Haga clic en el icono de eliminar
- Confirme la eliminación
- Nota: Las evaluaciones existentes que usan este criterio serán eliminadas

**Ejemplos de criterios**:
- Alineación estratégica: Baja, Media, Alta (peso 2)
- Valor de negocio: Bajo, Medio, Alto, Muy alto (peso 1.5)
- Nivel de riesgo: Bajo, Medio, Alto, Crítico (peso 1, invertido)
- Conformidad: Opcional, Recomendado, Obligatorio (peso 1, "Obligatorio" activa la omisión)

---

## Competencias

Defina las áreas de experiencia de los miembros del equipo para la asignación de proyectos.

### Gestión de competencias

Las competencias están agrupadas por categoría:
- Active o desactive competencias para hacerlas disponibles para asignaciones de equipo
- Añada, edite o elimine competencias según necesite

**Para establecer valores predeterminados**:
- Si no existen competencias, haga clic en **Establecer valores predeterminados** para llenar con competencias estándar de IT y negocio
- Las categorías incluyen: Desarrollo, Infraestructura, Análisis de negocio, Gestión de proyectos, etc.

**Para añadir una competencia**:
1. Haga clic en **Añadir competencia**
2. Seleccione o escriba un nombre de categoría
3. Introduzca el nombre de la competencia
4. Haga clic en **Guardar**

**Para deshabilitar una competencia**:
- Active/desactive el interruptor junto al nombre de la competencia
- Las competencias deshabilitadas no aparecerán en los selectores de competencias del equipo

---

## Plantillas de fases

Defina estructuras de fases estándar para aplicar a proyectos.

### Comprender las plantillas

Las plantillas de fases proporcionan:
- Estructuras de proyecto consistentes en toda la organización
- Configuración rápida al crear o planificar proyectos
- Hitos opcionales vinculados a cada fase

**Plantillas del sistema**:
- Plantillas predefinidas proporcionadas por KANAP
- Marcadas con una etiqueta "Sistema"
- Se pueden editar pero proporcionan valores predeterminados razonables

**Plantillas personalizadas**:
- Plantillas que usted crea para la metodología de su organización
- Útiles para diferentes tipos de proyecto (p. ej., Ágil, Cascada, Quick Win)

### Gestión de plantillas

**Para crear una plantilla**:
1. Haga clic en **Añadir plantilla**
2. Introduzca el nombre de la plantilla
3. Añada fases en orden:
   - Introduzca el nombre de la fase
   - Marque "Hito" si debe crearse un hito de completitud
   - Opcionalmente personalice el nombre del hito
4. Añada más fases según necesite
5. Haga clic en **Guardar**

**Para editar una plantilla**:
- Haga clic en el icono de editar
- Modifique nombre, fases o configuración de hitos
- Haga clic en **Guardar**

**Para eliminar una plantilla**:
- Haga clic en el icono de eliminar
- Confirme la eliminación
- Nota: Los proyectos existentes que usan esta plantilla no se ven afectados

**Ejemplos de plantillas**:
- Cascada: Análisis, Diseño, Desarrollo, Pruebas, Despliegue (todas con hitos)
- Ágil: Descubrimiento, MVP, Iteración 1, Iteración 2, Lanzamiento
- Quick Win: Planificación, Ejecución, Cierre

---

## Clasificación

Configure tipos, categorías y flujos para organizar solicitudes y proyectos.

Un nuevo espacio de trabajo empieza con tres orígenes (TI, Negocio, Cumplimiento) y tres categorías (Aplicaciones, Ciberseguridad, Infraestructura), sin línea. Sus nombres siguen el idioma del espacio de trabajo. Puede cambiarles el nombre, desactivarlos o eliminarlos como cualquier otro valor.

### Tipos

Los tipos describen la naturaleza del trabajo:
- **Mejora**: Mejoras a capacidades existentes
- **Nuevo desarrollo**: Construcción de nuevas capacidades
- **Mantenimiento**: Mantener los sistemas operativos
- **Infraestructura**: Plataforma y base técnica

**Para añadir un tipo**:
1. Haga clic en **Añadir tipo**
2. Introduzca nombre y descripción opcional
3. Haga clic en **Guardar**

**Para activar/desactivar un tipo**:
- Use el interruptor para habilitar/deshabilitar
- Los tipos deshabilitados no aparecerán en los desplegables de selección

### Categorías y flujos

Las categorías proporcionan agrupación de alto nivel, y los flujos ofrecen sub-categorización dentro de cada categoría.

**Estructura**:
```
Categoría (p. ej., "Transformación digital")
  ├── Flujo (p. ej., "Experiencia del cliente")
  ├── Flujo (p. ej., "Eficiencia operativa")
  └── Flujo (p. ej., "Analítica de datos")
```

**Para añadir una categoría**:
1. Haga clic en **Añadir categoría**
2. Introduzca nombre y descripción opcional
3. Haga clic en **Guardar**

**Para añadir un flujo**:
1. Expanda la categoría
2. Haga clic en **Añadir flujo**
3. Introduzca nombre y descripción opcional
4. Haga clic en **Guardar**

**Para activar/desactivar elementos**:
- Use los interruptores para habilitar/deshabilitar categorías o flujos
- Los elementos deshabilitados no aparecerán en los desplegables de selección
- Deshabilitar una categoría oculta todos sus flujos

**Elementos del sistema**:
- Categorías y tipos predefinidos marcados con etiqueta "Sistema"
- Se pueden editar o deshabilitar pero no eliminar
- Un elemento que todavía usan solicitudes o proyectos, o un tipo de tarea que usan tareas, no se puede eliminar. KANAP lo indica antes de pedirle confirmación y cuenta lo que lo usa. Desactívelo en su lugar

### Buenas prácticas

- Mantenga la lista de tipos corta (3-6 elementos)
- Use categorías para áreas de negocio principales o temas estratégicos
- Use flujos para agrupaciones más específicas dentro de las categorías
- Revise y limpie los elementos de clasificación no utilizados periódicamente

---

## Tipos de contrato

Los tipos de contrato registran cómo trabaja cada colaborador con usted. Aparecen como un desplegable en el panel Propiedades de cada colaborador, y como filtro en la página de Colaboradores. Cada colaborador empieza como Interno.

Cuatro tipos se crean con cada espacio de trabajo:

- **Interno**: el valor predeterminado de todo colaborador nuevo
- **Externo**
- **Aprendiz**
- **Otro**

### Gestionar los tipos de contrato

**Para agregar un tipo**:
1. Abra la pestaña **Tipos de contrato**
2. Haga clic en **Agregar tipo de contrato**
3. Escriba un nombre y haga clic en **Guardar**

**Para renombrar un tipo**: haga clic en el icono de edición, cambie el nombre y guarde. Los colaboradores que ya tienen ese tipo lo conservan.

**Para desactivar un tipo**: use el interruptor. Un tipo inactivo desaparece del desplegable para las nuevas asignaciones, pero los colaboradores que ya lo tienen lo conservan y lo siguen mostrando.

**Para eliminar un tipo**: haga clic en el icono de eliminación. Un tipo integrado, o un tipo que tienen colaboradores, se rechaza antes de la confirmación, con el motivo. El contador junto a cada tipo indica cuántos colaboradores lo tienen. Los cuatro tipos integrados pueden renombrarse pero nunca eliminarse. Para retirar un tipo que tienen colaboradores, desactívelo con el interruptor.

**Cargar valores predeterminados**: si la lista llegara a quedar vacía, **Cargar valores predeterminados** vuelve a crear Interno, Externo, Aprendiz y Otro.

Los tipos de contrato nunca se importan desde Microsoft Entra: son suyos.

---

## Consejos

  - **Comience con la evaluación**: Defina sus criterios de evaluación primero para que las solicitudes puedan priorizarse adecuadamente
  - **Use plantillas**: Cree plantillas que coincidan con la metodología de entrega de su organización
  - **Mantenga la clasificación simple**: Demasiadas opciones crean confusión; empiece con pocas y amplíe según necesite
  - **Revise regularmente**: A medida que su organización evoluciona, revise estas configuraciones para asegurar que siguen siendo relevantes
  - **Mantenga pocos tipos de contrato**: cuatro o cinco tipos suelen bastar para responder «quién es interno y quién no»

