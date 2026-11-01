---
title: "Guía rápida IT Ops: De la aplicación al servidor"
description: Documente su panorama de aplicaciones en minutos. Una guía práctica desde la creación de la app hasta la asignación del servidor.
---

# Guía rápida IT Ops: De la aplicación al servidor

Esta guía le acompaña en la documentación de una aplicación y su infraestructura de soporte, desde la creación de la entrada de la app hasta vincularla al servidor que la aloja. Está diseñada para hacerle productivo rápidamente, cubriendo los pasos esenciales sin abrumarle con opciones.

!!! tip "¿Prefiere un resumen en una página? :material-file-pdf-box:"
    Todos los pasos clave en una sola página A4: imprímala, cuélguela, compártala con su equipo.

    [:material-download: Descargar la hoja de referencia (PDF)](downloads/kanap-itops-fast-track.pdf){ .md-button .md-button--primary }

Para más detalles, consulte las documentaciones de referencia de [Aplicaciones](../applications.md) y [Activos](../assets.md).

---

## El panorama general

![Visión general de aplicación a servidor](images/app-to-server-overview.png)

Todo en el módulo Panorama IT de KANAP se conecta para crear una imagen completa de su panorama:

| Objeto | Qué representa |
|--------|----------------|
| **Aplicación** | Una app de negocio o servicio IT que necesita documentar |
| **Entorno** | Dónde se ejecuta: Prod, QA, Dev, etc. (llamados "Despliegues" en KANAP) |
| **Servidor (Activo)** | La infraestructura que la aloja: VMs, servidores físicos, contenedores |

La cadena es simple: **Aplicación → Entorno → Servidor**. Al final de esta guía, tendrá esta cadena completamente documentada.

![Modelo de relaciones de la aplicación](images/app-relationship-model.png)

!!! info "Por qué es importante"
    Cuando alguien pregunta "¿dónde se ejecuta esta app?", "¿quién es el responsable?" o "¿es conforme?", tendrá la respuesta en segundos en lugar de buscar en hojas de cálculo.

---

## Paso 1: Crear su aplicación

Vaya a **Panorama IT > Aplicaciones** y haga clic en **Nueva aplicación / servicio**.

Escriba el nombre en el título, por ejemplo `Salesforce CRM`, y pulse Intro. Su aplicación está ahora en el registro, y sus seis pestañas se abren para documentación detallada: **Vista general**, **Despliegues**, **Interfaces**, **Operaciones**, **Conformidad** y **Relaciones**.

Luego complete lo esencial en el encabezado y el panel de propiedades:

| Campo | Qué introducir | Ejemplo |
|-------|----------------|---------|
| **Categoría** | El propósito principal | `Línea de negocio` |
| **Proveedor** | El proveedor (de sus datos maestros) | `Salesforce Inc` |
| **Criticidad de negocio** | Importancia para el negocio | `Crítica para el negocio` |
| **Ciclo de vida** | Estado actual (Activo al crearla) | `Activo` |

Mientras siga en su página, **Cancelar la creación** en el encabezado elimina la nueva aplicación.

!!! tip "Empiece con lo que sabe"
    Descripción, editor, versión, licencia: todo útil, pero opcional en esta etapa. Puede enriquecer más tarde. El objetivo es tener la app en el sistema.

---

## Paso 2: Añadir un entorno (Despliegue)

Toda aplicación se ejecuta en algún sitio. La pestaña **Despliegues** documenta sus entornos.

Abra su aplicación y vaya a la pestaña **Despliegues**. Haga clic en **Agregar despliegue** y elija el entorno (PROD, PRE-PROD, QA, TEST, DEV o SANDBOX).

Para cada despliegue puede registrar:

| Campo | Qué hace | Ejemplo |
|-------|-------------|---------|
| **Entorno** | El tipo de entorno | `PROD` |
| **Ciclo de vida** | Estado propio del despliegue | `Activo` |
| **URL base** | La URL de acceso | `https://mycompany.salesforce.com` |
| **SSO habilitado** | ¿Está activo el inicio de sesión único? | `Sí` |
| **MFA admitido** | ¿Se admite la autenticación multifactor? | `Sí` |
| **Notas** | Cualquier contexto adicional | `Instancia principal UE` |

Cada despliegue aparece como una tarjeta, con sus servidores debajo (vea el paso 8). Use el icono de lápiz para editar un despliegue y el icono de eliminar para quitarlo.

Los cambios de un despliegue se guardan en cuanto confirma el cuadro de diálogo.

---

## Paso 3: Asignar responsables

Los responsables están en el panel **Propiedades**, a la derecha del espacio de trabajo de la aplicación.

### Responsables de negocio

Las partes interesadas de negocio responsables de la aplicación. Añada una o varias personas.

### Responsables IT

Los miembros del equipo IT responsables de la operación técnica y el soporte. Mismo mecanismo: añada las personas.

### Audiencia (Opcional)

En **Audiencia**, elija la **Empresa** y los **Departamentos** que usan esta aplicación. KANAP calcula el número de usuarios a partir de sus datos maestros, o puede pasar el cálculo a manual y escribir el número usted mismo.

!!! warning "Por qué importan los responsables"
    La responsabilidad facilita **contactar a las personas adecuadas** cuando importa: mantenimiento planificado, interrupciones del servicio, decisiones de actualización, renovaciones de licencias. También alimenta los filtros de alcance **Mis apps** y **Apps de mi equipo** de la lista principal. Sin responsables, la app solo es visible en la vista "Todas las apps", lo que significa que nadie se siente responsable de ella y nadie recibe avisos.

---

## Paso 4: Configurar métodos de acceso

Vaya a la pestaña **Operaciones**. En **Métodos de acceso**, seleccione cómo acceden los usuarios a esta aplicación:

- **Web**: acceso por navegador
- **Aplicación instalada localmente**: cliente de escritorio
- **Aplicación móvil**: app para teléfono/tableta
- **VDI / Escritorio remoto**: escritorio virtual
- **Terminal / CLI**: interfaz de línea de comandos
- **HMI propietaria**: interfaz industrial
- **Quiosco**: terminal dedicado

Los métodos de acceso se configuran en la [configuración del Panorama IT](../it-ops-settings.md#metodos-de-acceso), por lo que su lista puede incluir otras opciones.

Configure también:

| Campo | Qué significa |
|-------|--------------|
| **Acceso externo** | ¿Es esta app accesible desde Internet? |
| **Integración de datos / ETL** | ¿Participa esta app en flujos de datos? |

La misma pestaña contiene los contactos de **Soporte** (use **Agregar contacto** y asigne un rol a cada uno) y **Notas de soporte** de texto libre.

---

## Paso 5: Vincular a otros objetos (Relaciones)

Vaya a la pestaña **Relaciones** para conectar su aplicación con el resto de sus datos de gestión IT.

| Tipo de vínculo | Qué conecta | Por qué |
|-----------|----------------------|-----|
| **Líneas OPEX** | Costes recurrentes (licencias, cuotas SaaS) | Ver el coste completo |
| **Líneas CAPEX** | Proyectos de inversión | Seguir la inversión |
| **Contratos** | Acuerdos con proveedores | Saber cuándo vencen las renovaciones |
| **Proyectos** | Proyectos del portafolio | Conectar con su portafolio de proyectos |
| **Sitios web relevantes** | Documentación, wikis, runbooks | Acceso rápido a recursos externos |
| **Adjuntos** | Archivos (arrastrar y soltar o selector) | Mantener especificaciones y documentos junto a la app |

La pestaña también permite vincular **Tareas**, y las suites listan allí sus **Componentes**.

!!! tip "Puede hacerlo más tarde"
    Las relaciones son útiles pero no bloquean nada. Créelas cuando tenga los datos: la app funciona plenamente sin ellas.

---

## Paso 6: Añadir información de conformidad

Vaya a la pestaña **Conformidad**. Es cada vez más importante para auditorías y requisitos regulatorios.

| Campo | Qué introducir | Ejemplo |
|-------|--------------|---------|
| **Criticidad de negocio** / **Criticidad cibernética** | Lo crítica que es la app | `Crítica para el negocio` |
| **Confidencialidad de los datos** | Nivel de sensibilidad | `Confidencial` |
| **Contiene datos personales** | ¿Almacena datos personales? | `Sí` |
| **Residencia de datos** | Países donde se almacenan los datos | `Francia, Alemania` |
| **Última prueba de recuperación** | Fecha de la última prueba de recuperación ante desastres | `2025-11-15` |

La pestaña también incluye la **Ola de recuperación**, los objetivos de recuperación (RTO y RPO) y una **Justificación**. Cuando termine, marque la clasificación como revisada.

!!! info "Los niveles de clasificación son configurables"
    Las clases de datos por defecto (Público, Interno, Confidencial, Restringido) y los niveles de criticidad se pueden personalizar en **Panorama IT > Configuración** para ajustarse a la política de clasificación de su organización.
---

## Paso 7: Crear su servidor (Activo)

Vaya a **Panorama IT > Activos** y haga clic en **Añadir activo**.

### Pestaña Vista general

Complete los campos principales:

| Campo | Qué introducir | Ejemplo |
|-------|--------------|---------|
| **Nombre** | Nombre de host o identificador | `PROD-WEB-01` |
| **Tipo de activo** | El tipo de servidor (desplegable) | `Máquina virtual` |
| **Ubicación** | Dónde está alojado (obligatorio) | `Centro de datos París` |
| **Entorno** | A qué entorno sirve | `Prod` |
| **Descripción** | Cualquier contexto adicional |  |

El panel **Propiedades** a la derecha contiene el resto: el conmutador **Clúster**, **Zona de administración**, **Sub-ubicación**, **Ciclo de vida**, **Fecha de puesta en marcha** y **Fecha de fin de vida**. Una vez seleccionada una ubicación, varios **campos de solo lectura** se derivan automáticamente:

- **Tipo de alojamiento** (on-premises, nube, colocation, etc.)
- **Proveedor cloud / Empresa operadora** (p. ej., AWS, Azure o la empresa que opera la instalación)
- **País**
- **Ciudad**

!!! info "La ubicación es la clave"
    La ubicación determina automáticamente muchos atributos de su activo. Las ubicaciones se gestionan en **Panorama IT > Ubicaciones**. Configúrelas una vez y cada activo asignado a ellas hereda el tipo de alojamiento, el proveedor, el país y la ciudad. No tiene que rellenarlos manualmente.

### Pestaña Red

La pestaña **Red** está abierta mientras crea el activo. Complete:

| Sección | Campos | Detalles |
|---------|--------|---------|
| **Identidad** | Nombre de host, Dominio, FQDN, Alias | El FQDN se calcula automáticamente a partir del nombre de host y el dominio |
| **Direcciones IP** | Tipo, Dirección IP, Subred | La zona de red y la VLAN se derivan de la subred |

!!! info "Varias direcciones IP"
    Un servidor puede tener varias direcciones IP: añada tantas como necesite (p. ej., interfaz de gestión, VLAN de producción, red de copias de seguridad). Cada entrada puede tener su propio tipo y subred, y la zona de red y la VLAN se derivan automáticamente.

Haga clic en **Crear** para desbloquear el espacio de trabajo completo. La pestaña **Vista general** gana entonces una sección **Soporte** para el contrato de soporte del proveedor y sus contactos. Para tipos de activos físicos, una pestaña **Hardware** hace seguimiento de los números de serie y los detalles del fabricante.

### Pestaña Operaciones

Vaya a la pestaña **Operaciones** para añadir las **Tecnologías** que lleva el servidor, con sus versiones. Añada Windows Server, Ubuntu u otra tecnología de la familia **Sistema operativo**: pasa a ser el sistema operativo del servidor.

Si este activo es un clúster, active el conmutador **Clúster** en el panel **Propiedades** y luego añada sus servidores miembros con **Añadir miembros** en la parte superior de la pestaña **Operaciones**. Una aplicación que se ejecuta en cada miembro se asigna al clúster: consulte [Aplicaciones en un clúster](../assets.md#applications-on-a-cluster).

---

## Paso 8: Vincular el servidor a su aplicación

Esta es la conexión final: vincular su servidor al entorno de aplicación que soporta.

Hay **dos formas** de crear esta asignación:

### Desde el lado de la aplicación

1. Abra su aplicación
2. Vaya a la pestaña **Despliegues**
3. En la tarjeta del despliegue **PROD**, haga clic en **Agregar servidor**
4. Seleccione su activo (`PROD-WEB-01`)
5. Defina el **Rol** (Web, Base de datos, Aplicación, etc.) y, opcionalmente, la fecha **Desde** y **Notas**

### Desde el lado del activo

1. Abra su activo
2. En la pestaña **Operaciones**, localice la sección **Aplicaciones alojadas**
3. Haga clic en **Añadir asignación**
4. Complete los campos de la asignación:

| Campo | Qué introducir | Ejemplo |
|-------|--------------|---------|
| **Aplicación** | La aplicación a vincular | `Salesforce CRM` |
| **Entorno** | Qué despliegue | `PROD` |
| **Rol** | Rol del servidor para esta app | `Web` |
| **Fecha desde** | Cuándo empezó la asignación | `2025-01-15` |
| **Notas** | Cualquier contexto |  |

!!! success "La cadena está completa"
    Ahora tiene la ruta completa documentada:

    **Salesforce CRM** → **Despliegue PROD** → **PROD-WEB-01**

    Cualquiera puede ir de "¿qué app?" a "¿qué servidor?" y a "¿dónde está?" en segundos.
---

## Cómo se conecta todo

Cada dato que introduce alimenta algo más grande:

### Vista del panorama de aplicaciones

Su lista de Aplicaciones se convierte en un registro vivo que muestra cada aplicación con sus entornos, criticidad, tipo de alojamiento y propiedad, filtrable por cualquier atributo.

### Mapeo de infraestructura

Los activos vinculados a despliegues de aplicación le permiten responder preguntas como:

- "¿Qué servidores soportan esta app crítica para el negocio?"
- "¿Qué aplicaciones se verán afectadas si este servidor se cae?"
- "¿Cuántas apps están alojadas en este centro de datos?"

### Informes de conformidad

La clasificación de datos, indicadores de PII y la residencia de datos fluyen hacia vistas de conformidad. Cuando el auditor pregunta "¿dónde se almacenan los datos de clientes?", tiene una respuesta documentada y trazable.

### Base de conocimiento

Tanto Aplicaciones como Activos tienen una sección de **Base de conocimiento** en su pestaña **Vista general** donde puede vincular runbooks, decisiones de arquitectura, procedimientos operativos y documentación interna. Tener estas referencias adjuntas a los registros correctos significa que su equipo puede encontrar lo que necesita durante incidentes sin buscar en wikis.

### Mapa de conexiones

Una vez documentados los activos, puede crear **Conexiones** (Servidor a servidor o Multi-servidor) entre ellos para visualizar flujos de red y dependencias. El [Mapa de conexiones](../connection-map.md) los renderiza como un grafo interactivo con niveles verticales basados en roles para una vista de estilo arquitectura.

### Interfaces y Mapa de interfaces

Vaya un paso más allá: documente **Interfaces** entre aplicaciones para capturar flujos de datos, puntos de integración y contexto de negocio. Cada interfaz tiene cinco pestañas para una documentación completa: Vista general, Flujo, Entornos, Mapeo de datos y Relaciones.

Luego utilice el [Mapa de interfaces](../interface-map.md) para visualizar el flujo completo de aplicaciones. En la vista de Negocio predeterminada, verá relaciones limpias origen-destino. Cambie a la vista Técnica para revelar plataformas middleware como nodos en forma de diamante, mostrando la ruta real de datos. El filtrado por profundidad cuenta solo los nodos de aplicación principales: el middleware es transparente, por lo que seleccionar una app con profundidad 2 le muestra dos saltos reales independientemente de cuántas plataformas middleware haya en medio.

---

## Referencia rápida

| Quiero... | Ir a... |
|-----------|---------|
| Crear una aplicación | Panorama IT > Aplicaciones > Nueva aplicación / servicio |
| Añadir entornos | Abrir app > pestaña Despliegues > Agregar despliegue |
| Asignar responsables | Abrir app > panel Propiedades |
| Configurar métodos de acceso | Abrir app > pestaña Operaciones |
| Vincular presupuestos/contratos | Abrir app > pestaña Relaciones |
| Adjuntar documentos de conocimiento | Abrir app > pestaña Vista general > Base de conocimiento |
| Añadir información de conformidad | Abrir app > pestaña Conformidad |
| Crear un servidor | Panorama IT > Activos > Añadir activo |
| Vincular servidor a app (desde la app) | Abrir app > pestaña Despliegues > Agregar servidor |
| Vincular servidor a app (desde el activo) | Abrir activo > pestaña Operaciones > Aplicaciones alojadas > Añadir asignación |
| Ver conexiones del servidor | Abrir activo > pestaña Red > Conexiones |
| Ver mapa de conexiones | Panorama IT > Mapa de conexiones |
| Ver mapa de interfaces | Panorama IT > Mapa de interfaces |
| Configurar desplegables | Panorama IT > Configuración |

---

!!! success "Está listo"
    Ahora sabe cómo documentar la cadena completa de la aplicación al servidor. Comience con sus apps más críticas, añada sus entornos de producción, vincule los servidores y tendrá un panorama IT vivo y consultable en poco tiempo. Para documentación detallada de cada funcionalidad, explore las secciones de referencia de [Aplicaciones](../applications.md) y [Activos](../assets.md).
