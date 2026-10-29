# Fin de soporte

El informe Fin de soporte lista lo que ha llegado, o llega pronto, al fin de su soporte, y lo que afecta cada elemento: los servidores que lo ejecutan y las aplicaciones que dependen de él. Una segunda vista lista los datos que faltan y que impiden al informe responder.

Ábralo desde **Panorama IT > Fin de soporte**, en el grupo **Operaciones**. Necesita `infrastructure:reader`. Las columnas y las filas de aplicaciones solo aparecen si también puede leer las aplicaciones.

## Vencimientos

La vista **Vencimientos** muestra una fila por elemento cuyo soporte ha terminado, o termina dentro del horizonte. El subtítulo indica el último día que cubre el horizonte.

Lo que vigila el informe:

| Tipo | Lo que termina | De dónde viene la fecha |
|---|---|---|
| **Tecnología** | Una versión en uso en un servidor en servicio, o declarada por una aplicación en servicio | El fin del soporte estándar y extendido de la versión, en la [tecnología](technologies.md#resumen) |
| **Sistema operativo** | Una versión de un sistema operativo en uso en un servidor en servicio | El fin del soporte estándar y extendido de la versión, en la tecnología de la familia **Sistema operativo** |
| **Aplicación** | Una aplicación en servicio | Su fecha de fin de soporte |
| **Hardware** | Un activo físico en servicio | Su fin de vida o el fin de su contrato de soporte, indicado en la columna **Versión** |

Quedan fuera los activos retirados, las aplicaciones desactivadas y las versiones que nadie usa.

**Filtros**:

- **Tipo**: uno de los cuatro tipos, o **Todos los tipos**.
- **Horizonte**: 6, 12, 24 o 36 meses. 12 meses por defecto.

**Columnas**: **Tipo**, **Elemento** (abre la ficha), **Versión**, **Fecha de fin**, **Estado**, **Servidores** y **Aplicaciones** (cuántos afecta cada elemento).

**Estado**:

- **Sin soporte**: todas las fechas de fin han pasado.
- **Soporte extendido**: el soporte estándar ha terminado, el soporte extendido sigue vigente.
- **Termina pronto**: el soporte termina dentro del horizonte.

**Lo que afecta un elemento**: haga clic en una fila para desplegar los servidores y las aplicaciones que hay detrás de sus contadores. Cada nombre abre su ficha.

- Una versión de tecnología afecta a los servidores en los que está instalada, y a las aplicaciones que la declaran o están alojadas en un servidor que la lleva (incluidas las máquinas virtuales de dicho servidor).
- Un sistema operativo afecta a los servidores que usan esa versión, y a las aplicaciones desplegadas en ellos y en lo que contienen. Su fila abre la tecnología.
- Un hardware afecta a sus servidores, a lo que contienen y a las aplicaciones desplegadas en todos ellos. El propio hardware no es uno de sus servidores.
- Una aplicación afecta a los servidores en los que está desplegada. En un clúster, son el clúster y sus miembros en servicio.

Los servidores de una tecnología o de un sistema operativo se cuentan como en la columna **Servidores** de la [lista de tecnologías](technologies.md): los servidores en servicio en los que está instalada la versión, sin los clústeres. Los servidores de un hardware son los activos que lleva, sin los clústeres. Las aplicaciones de un clúster siguen contando.

## Datos que faltan

La vista **Datos que faltan** lista las fichas que hay que completar para que los vencimientos sean correctos. Haga clic en una fila para abrir la ficha.

| Dato que falta | Qué significa |
|---|---|
| **Aplicación alojada sin servidor** | Una aplicación alojada en sus instalaciones o en una nube privada no tiene ningún servidor en un despliegue en servicio |
| **Máquina virtual sin host** | Ningún activo contiene esta máquina virtual |
| **Tecnología local en ningún servidor** | Una tecnología cuyo tipo de alojamiento es local (Local, Colocation) no se ejecuta en ningún servidor |
| **Tecnología sin tipo de alojamiento de los ajustes de TI** | El tipo de alojamiento de la tecnología ya no está en la lista **Tipos de alojamiento** de la configuración. Elija otro en la tecnología |
| **Servidor de base de datos sin tecnología de base de datos** | Un servidor tiene un rol de base de datos para una aplicación, pero no lleva ninguna tecnología de la familia **Base de datos** |
| **Aplicación con SSO sin tecnología de identidad** | Una aplicación usa SSO y no tiene ninguna tecnología de la familia **Directorio e identidad** |
| **Vínculo de tecnología sin versión** | Un servidor o una aplicación usa una tecnología sin indicar qué versión |
| **Versión en uso sin fecha de fin de soporte** | El informe no puede saber cuándo termina esta versión |

Las filas sobre aplicaciones requieren el derecho de leer las aplicaciones.

## Exportación e impresión

**Exportar la tabla** descarga la lista en pantalla como archivo CSV o Excel: los vencimientos con el horizonte y el tipo actuales, o los datos que faltan. Los encabezados siguen el idioma de su pantalla, y en el archivo Excel las fechas son fechas reales y se añade una hoja **Parámetros**. Consulte [Informes](reports.md#export-options). **Imprimir / Guardar como PDF** imprime el informe.

## Preguntar al asistente

[Plaid](ai-assistant.md) lee las dos vistas, **Vencimientos** y **Datos que faltan**, con los mismos derechos que el informe. Nombra cada elemento por su referencia (`APP-4`, `AST-12`, `TEC-3`) y lee un horizonte a la vez: 6, 12, 24 o 36 meses. Plaid lista los vencimientos 30 a la vez y puede leer las páginas siguientes; sus recuentos y totales cubren todos los vencimientos. Cuando usted no puede leer las aplicaciones, Plaid dice que dejó fuera las filas de las aplicaciones.

Plaid también puede añadir versiones de tecnología y corregir sus fechas de soporte, con su aprobación. El fin de soporte de una aplicación es un campo de la aplicación: Plaid lo cambia como cambia la aplicación, con los derechos de la página [Aplicaciones](applications.md).

Pregunte, por ejemplo: «¿Qué aplicaciones llegan al fin de soporte en los próximos seis meses?», «Vencimientos de fin de soporte de los próximos doce meses por tipo», «¿Qué fichas hay que completar para el informe de fin de soporte?», «La versión 16 de PostgreSQL termina su soporte el 31/12/2028» o «Borra la fecha de fin del soporte extendido de la versión 14 de TEC-3».

## Consejos

- **Resuelva primero los datos que faltan**: un servidor sin sus tecnologías, o una versión sin fecha, nunca aparece en los vencimientos.
- **Mire a 24 meses para los presupuestos**: una migración prevista para el año próximo necesita su dinero en el presupuesto de este año.
- **Use el catálogo**: las tecnologías añadidas desde el catálogo llegan con sus fechas de fin de soporte. Proceden de endoflife.date o, para los productos que mantiene KANAP, de las páginas oficiales del editor (consulte [Versiones del catálogo](technologies.md#versiones-del-catalogo)).
