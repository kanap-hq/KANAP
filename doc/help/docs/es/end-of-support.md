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

- Una versión de tecnología afecta a los servidores que la llevan (incluidas las máquinas virtuales de un host que la lleva) y a las aplicaciones alojadas en ellos o que la declaran.
- Un sistema operativo afecta a los servidores que usan esa versión, a lo que contienen y a las aplicaciones desplegadas en todos ellos. Su fila abre la tecnología.
- Un hardware afecta a sus servidores, a lo que contienen y a las aplicaciones desplegadas en todos ellos.
- Una aplicación afecta a los servidores en los que está desplegada.

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

**Exportar la tabla en CSV** descarga la lista en pantalla: los vencimientos con el horizonte y el tipo actuales, o los datos que faltan. Los encabezados siguen el idioma de su pantalla. **Imprimir / Guardar como PDF** imprime el informe.

## Consejos

- **Resuelva primero los datos que faltan**: un servidor sin sus tecnologías, o una versión sin fecha, nunca aparece en los vencimientos.
- **Mire a 24 meses para los presupuestos**: una migración prevista para el año próximo necesita su dinero en el presupuesto de este año.
- **Use el catálogo**: las tecnologías añadidas desde el catálogo llegan con sus fechas de fin de soporte. Proceden de endoflife.date o, para los productos que mantiene KANAP, de las páginas oficiales del editor (consulte [Versiones del catálogo](technologies.md#versiones-del-catalogo)).
