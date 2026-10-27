---
title: "Guía rápida de tipos de trabajo: Run, Build y Tareas"
description: Comprenda los diferentes tipos de elementos de trabajo en KANAP (incidentes, problemas, solicitudes, proyectos, bugs y tareas) y cómo trabajar con tareas en el día a día.
---

# Guía rápida de tipos de trabajo: Run, Build y Tareas

Esta guía explica los diferentes tipos de elementos de trabajo registrados en KANAP y cómo diferenciarlos. Cubre el Run (mantener las cosas funcionando), el Build (mejorar las cosas) y la Tarea transversal que conecta ambos. La segunda mitad es una hoja de referencia práctica para trabajar con tareas cada día.

!!! tip "¿Prefiere un resumen en una página? :material-file-pdf-box:"
    Todas las definiciones clave en una sola página A4: imprímala, cuélguela, compártala con su equipo.

    [:material-download: Descargar la hoja de referencia (PDF)](downloads/kanap-task-types-fast-track.pdf){ .md-button .md-button--primary }

---

## El panorama general

Todo lo que hace su departamento IT cae en una de dos categorías, más una unidad de trabajo universal que cruza ambas:

| Categoría | Propósito | Elementos de trabajo |
|-----------|-----------|---------------------|
| **Run** | Mantener los sistemas existentes operativos y seguros | Incidente, Problema |
| **Build** | Evolucionar y construir el panorama IT | Solicitud, Proyecto, Bug |
| **Transversal** | Unidad atómica de trabajo entre Run y Build | Tarea |

---

## Run: mantener las luces encendidas

Todos participan en el Run. Asegura la **continuidad operativa** (MCO) y el **mantenimiento de seguridad** (MCS) de los sistemas existentes.

### Incidente

Una **interrupción o degradación no planificada** de un servicio en producción.

- Tiene un impacto significativo en el funcionamiento del sistema de información
- El objetivo es la **restauración del servicio**: hacer que las cosas funcionen de nuevo, rápido
- De naturaleza reactiva: algo se rompió y los usuarios se ven afectados

!!! example "Ejemplos"
    - Caída del sistema MES
    - Reinicio inesperado de VM
    - Fallo de acceso VPN a nivel de toda la empresa

### Problema

Una **investigación de causa raíz** desencadenada por incidentes recurrentes.

- Típicamente identificado por IT después de detectar un **patrón de incidentes similares**
- El objetivo es una **resolución permanente**: corregir la causa subyacente, no solo los síntomas
- Proactivo: IT abre un Problema para prevenir incidentes futuros

!!! example "Ejemplos"
    - Degradación recurrente del rendimiento de acceso a internet
    - Errores repetidos en una interfaz de datos

---

## Build: evolucionando el panorama

El Build cubre todas las **evoluciones y construcciones** del sistema de información. Todos participan.

### Solicitud (Solicitud de cambio)

Una **solicitud planificada para modificar** el sistema de información.

- Puede ser técnica, funcional, originada del negocio o de IT
- Raramente urgente
- Desencadena un **flujo de trabajo de validación** y, si se aprueba, se convierte en una Tarea o Proyecto
- Cumple al menos uno de estos criterios:
    - Carga de trabajo significativa (>3 días)
    - Involucra múltiples equipos IT o de negocio
    - Requiere un esfuerzo significativo de gestión del cambio

!!! example "Ejemplos"
    - Nuevo campo a sincronizar entre SAP y PLM
    - Nueva aplicación de línea de negocio
    - Integración de sede remota

### Proyecto

Un **conjunto coordinado de tareas** organizadas en torno a un objetivo definido, con alcance, cronograma, presupuesto y entregables identificados.

- Mismos criterios que una Solicitud. Normalmente se origina de una Solicitud aprobada
- **Vía rápida**: algunos proyectos se imponen sin pasar por la etapa de Solicitud (decisión ejecutiva, cambio regulatorio urgente...). Entran directamente como Proyecto.

!!! example "Ejemplos"
    - Actualización a S4/HANA
    - Migración de firewall

### Bug

Un **defecto encontrado en un sistema en desarrollo**.

- Demasiado complejo para manejarse con un simple ticket: requiere análisis en profundidad
- Estrictamente un concepto de Build: el sistema no está aún en producción (o el defecto está en un componente aún en construcción)

!!! example "Ejemplos"
    - Derechos de acceso insuficientes en un nuevo tile de SAP
    - Regla de firewall incorrecta en un nuevo despliegue de servidor

!!! warning "Incidente vs Bug"
    Esta es la confusión más común. La regla es simple:

    - **¿Funciona en producción y se rompe?** → **Incidente** (Run)
    - **¿Está en construcción y no funciona?** → **Bug** (Build)

    La distinción importa porque los Incidentes priorizan la **restauración del servicio** mientras que los Bugs priorizan la **corrección de la causa raíz dentro del ciclo de desarrollo**.

---

## Transversal: la Tarea

Las Tareas son la **unidad atómica de trabajo** en KANAP. Cruzan la frontera entre Run y Build.

### Tarea

Una **acción claramente delimitada** con una persona responsable definida, estado y fecha límite.

- Puede ser **independiente** o vinculada a un **Proyecto**, **línea OPEX**, **Contrato** o **línea CAPEX**
- Conlleva un esfuerzo concreto
- El impacto en usuarios o servicios está contenido y bien entendido
- No requiere coordinación entre múltiples equipos: incluso si toma mucho tiempo, permanece llevada por una sola persona sin requerir análisis interfuncional

!!! example "Ejemplos"
    - Instalar un nuevo controlador de dominio
    - Documentar la nueva interfaz de Notilus a S4/HANA
    - Renovar el certificado SSL del portal de intranet

!!! info "Tarea vs Solicitud/Proyecto"
    Si el trabajo cumple **alguno** de estos criterios, es una Solicitud (y potencialmente un Proyecto), no una Tarea:

    - Carga de trabajo significativa (>3 días) **Y** involucra análisis interfuncional
    - Requiere coordinación entre múltiples equipos
    - Necesita gestión del cambio significativa

    Una Tarea puede durar 10 días si es llevada por una persona sin complejidad interfuncional particular.

---

## Tabla resumen

| Tipo | Categoría | Criterio clave | Ejemplo |
|------|-----------|----------------|---------|
| **Incidente** | Run | Interrupción/degradación no planificada en producción | Caída del MES |
| **Problema** | Run | Causa raíz de incidentes recurrentes | Problemas recurrentes de rendimiento de internet |
| **Solicitud** | Build | Modificación planificada del SI (>3d / multi-equipo / gestión del cambio) | Nuevo campo SAP a PLM |
| **Proyecto** | Build | Conjunto coordinado de tareas con alcance, cronograma, presupuesto | Actualización S4/HANA |
| **Bug** | Build | Defecto en un sistema en desarrollo | Regla de firewall incorrecta en nuevo servidor |
| **Tarea** | Transversal | Acción delimitada, un responsable, sin coordinación multi-equipo | Renovar un certificado SSL |

---

## Trabajar con tareas: hoja de referencia

El resto de esta guía cubre lo esencial práctico. Para el detalle completo, consulte [Tareas](../tasks.md).

### Dónde viven las tareas

| Contexto | Qué significa | Dónde crear |
|----------|---------------|-------------|
| **Independiente** | Trabajo independiente, no vinculado a nada | **Portafolio > Tareas > Nuevo** |
| **Proyecto** | Entregable dentro de un proyecto | Espacio de trabajo del Proyecto pestaña **Tareas**, o atajo de fase en **Cronograma** |
| **OPEX** | Acción vinculada a una línea OPEX | Espacio de trabajo de la línea presupuestaria, panel **Tareas** de la pestaña **Vista general** |
| **Contrato** | Acción vinculada a un contrato | Espacio de trabajo del Contrato pestaña **Tareas** |
| **CAPEX** | Acción vinculada a una línea CAPEX | Espacio de trabajo de la línea presupuestaria, panel **Tareas** de la pestaña **Vista general** |

Todas las tareas aparecen en la lista central **Portafolio > Tareas** independientemente del contexto, para que siempre tenga un lugar donde ver todo.

### Estados de un vistazo

| Estado | Color | Significado |
|--------|-------|-------------|
| **Abierto** | Gris | Aún no comenzado |
| **En progreso** | Naranja | Alguien está trabajando en ello |
| **Pendiente** | Azul | Bloqueado, esperando información o decisión |
| **En pruebas** | Púrpura | Implementación hecha, esperando validación |
| **Completado** | Verde | Terminado (requiere tiempo registrado para tareas de proyecto) |
| **Cancelado** | Rojo | Ya no es necesario |

### Niveles de prioridad

| Prioridad | Cuándo usar |
|-----------|-------------|
| **Bloqueante** | Bloquea otro trabajo: atención inmediata |
| **Alta** | Importante y urgente |
| **Normal** | Prioridad estándar (predeterminada) |
| **Baja** | Puede aplazarse |
| **Opcional** | Deseable |

### El espacio de trabajo de tareas: áreas clave

Cuando abre una tarea, tiene una barra lateral a la izquierda y un área de contenido principal a la derecha.

**Secciones de la barra lateral**:

- **Contexto**: a qué está vinculada la tarea (o Independiente)
- **Detalles de la tarea**: tipo, prioridad, estado
- **Clasificación**: Origen, Categoría, Flujo, Empresa (solo tareas independientes y de proyecto; valores predeterminados de la configuración de la organización o del proyecto padre)
- **Tiempo**: tiempo total invertido y botón Registrar tiempo (solo tareas independientes y de proyecto)
- **Personas**: solicitante, asignado, visores
- **Fechas**: fechas de inicio y vencimiento
- **Base de conocimiento**: vincular artículos de conocimiento a la tarea

**Contenido principal**:

- **Descripción**: un editor markdown con soporte para formato, listas, bloques de código, enlaces e imágenes pegadas
- **Importar / Exportar**: importar un archivo `.docx` en la descripción, o exportar como PDF, DOCX u ODT
- **Adjuntos**: subida de archivos por arrastrar y soltar (hasta 20 MB por archivo)
- **Actividad**: pestañas de Comentarios, Historial y Registro de tiempo

### Acciones rápidas que conviene conocer

| Acción | Cómo |
|--------|------|
| **Guardar** | Haga clic en **Guardar** o pulse **Ctrl+S** (Cmd+S en Mac) |
| **Convertir a solicitud** | Barra de herramientas del encabezado. Promueve una tarea a solicitud formal del portafolio cuando el alcance crece |
| **Compartir** | Barra de herramientas del encabezado. Enviar un enlace por correo a colegas o contactos externos |
| **Registrar tiempo en línea** | En la pestaña Comentarios, combine un comentario + cambio de estado + entrada de tiempo en un solo envío |
| **Copiar referencia** | Haga clic en el chip de referencia (p. ej., T-42) para copiarlo al portapapeles |

### Qué varía según el contexto

No todas las funcionalidades están disponibles en todos los contextos. Esto es lo que cambia:

| Funcionalidad | Independiente | Proyecto | OPEX / Contrato / CAPEX |
|---------------|:------------:|:--------:|:-----------------------:|
| Campos de clasificación | Sí | Sí (predeterminados del proyecto) | No |
| Seguimiento de tiempo | Sí | Sí (alimenta el realizado del proyecto) | No |
| Asignación de fase | No | Sí | No |
| Insignia de puntuación de prioridad | Fija por prioridad | Calculada desde proyecto + prioridad | Fija por prioridad |
| Completado requiere tiempo registrado | No | Sí | No |

### Valores predeterminados de clasificación

Cuando crea una **tarea independiente**, KANAP prerellena los campos de clasificación (Origen, Categoría, Flujo, Empresa) desde la configuración predeterminada de su organización, ahorrándole unos clics. Para **tareas de proyecto**, los valores predeterminados de clasificación provienen del proyecto padre pero pueden cambiarse independientemente en cada tarea.

---

## Personalizar tipos de trabajo

Todos los tipos de elementos de trabajo son **configurables** en **Portafolio > Configuración**. Puede:

- **Añadir** nuevos tipos para coincidir con los procesos de su organización
- **Deshabilitar** tipos existentes que no necesite
- **Renombrar** tipos para ajustarse a su terminología

Los cuatro tipos predeterminados (Tarea, Bug, Problema, Incidente) se muestran en el idioma de cada usuario mientras conserve sus nombres. Un tipo renombrado muestra su nuevo nombre en todos los idiomas.

La lista de esta guía es un punto de partida. Adáptela a cómo funciona realmente su departamento IT.

---

## Adónde ir a continuación

- [Tareas](../tasks.md): referencia completa para estados, importación y exportación, seguimiento de tiempo y cada funcionalidad del espacio de trabajo
- [Líneas presupuestarias](../budget-lines.md): gestionar las líneas OPEX y CAPEX y sus tareas
- [Contratos](../contracts.md): gestionar contratos y sus tareas
- [Proyectos del portafolio](../portfolio-projects.md): ejecución de proyectos, fases, seguimiento de esfuerzo y tareas a nivel de proyecto
- [Primeros pasos](getting-started.md): si es nuevo en KANAP

!!! success "Está listo"
    Ahora comprende cómo KANAP categoriza el trabajo y cómo usar tareas en el día a día. Cuando dude sobre el tipo de elemento de trabajo adecuado, pregúntese: **¿mantiene las cosas funcionando (Run) o mejora las cosas (Build)?** Luego elija el tipo correspondiente. Para todo lo demás, hay una Tarea.
