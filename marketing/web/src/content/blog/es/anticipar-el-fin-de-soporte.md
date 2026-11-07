---
title: "Anticipar el fin de soporte"
description: "Windows Server 2012, SQL Server 2016, Ubuntu 20.04: la fecha de fin de soporte se conoce, lo que depende de ella rara vez. El informe de fin de soporte de KANAP nombra los servidores y las aplicaciones afectados, con tiempo para presupuestar la migración."
date: 2026-11-09
topic: mapping
features: [it-landscape]
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: anticipate-end-of-support
---

Octubre de 2023: Windows Server 2012 sale de su soporte extendido. Muchos CIO se enteraron por una auditoría, o por el presupuesto del soporte extendido de pago. La fecha se conocía desde hacía años. Lo que faltaba era la lista de aplicaciones que seguían ejecutándose sobre él, y por tanto el coste de migrarlas.

Lo mismo vale para cada versión de un sistema operativo, una base de datos, un hipervisor o un equipo. Saber que una versión llega al fin de soporte no basta. Hay que saber qué sostiene, quién responde de ella, y saberlo con tiempo para que la migración entre en el presupuesto del año.

Así lo resuelve KANAP: una vista de todos los vencimientos, lo que afecta cada uno y la lista de datos que completar para que la respuesta sea correcta.

## Una vista, cuatro tipos de vencimientos

![La vista Vencimientos del informe de fin de soporte, a 24 meses: sistemas operativos, bases de datos, aplicaciones y hardware.](/screenshots/end-of-support-deadlines-2026-11-07.png)

El informe se abre desde **Panorama IT > Fin de soporte**. Su vista Vencimientos reúne cuatro tipos de vencimientos:

- **Las tecnologías**: una versión en uso en un servidor, o declarada por una aplicación. SQL Server 2016, vSphere 7, Tomcat 9.
- **Los sistemas operativos**: Windows Server, las distribuciones Linux, AIX, en uso en sus servidores.
- **Las aplicaciones**: su propia fecha de fin de soporte, la que el fabricante anuncia para su versión.
- **El hardware**: el fin de vida de un equipo físico, o el fin de su contrato de soporte.

Se elige el horizonte: 6, 12, 24 o 36 meses. Cada fila lleva un estado: sin soporte, soporte extendido, termina pronto. Lo que está retirado o ya nada utiliza no aparece.

Las fechas no se introducen a mano. Vienen del catálogo de tecnologías, alimentado por endoflife.date y por las páginas de los fabricantes que KANAP consulta, y se actualizan cuando un fabricante las cambia. El artículo [Tecnologías: el vínculo entre servidores y aplicaciones](/es/blog/tecnologias-el-vinculo-entre-servidores-y-aplicaciones) explica cómo se mantiene este catálogo.

## Lo que afecta cada vencimiento

![Una fila desplegada: los servidores que llevan la versión y las aplicaciones que dependen de ella.](/screenshots/end-of-support-impact-2026-11-07.png)

Cada fila muestra dos contadores, servidores y aplicaciones. Un clic la despliega: aparecen los nombres, y cada uno abre su ficha.

Para encontrarlos, KANAP sigue los vínculos de la cartografía:

- **Una versión de tecnología** afecta a los servidores en los que está instalada, y a las aplicaciones que la declaran o se ejecutan en esos servidores, máquinas virtuales incluidas.
- **Un servidor físico** al final de su vida afecta a las máquinas que aloja y a las aplicaciones desplegadas en todos ellos.
- **Un clúster** cuenta sus miembros: SQL Server instalado en el clúster afecta a cada uno de sus nodos. El artículo [Los clústeres en la cartografía de KANAP](/es/blog/los-clusteres-en-la-cartografia-de-kanap) detalla estas reglas.

La respuesta no se queda, por tanto, en «Ubuntu 20.04 está sin soporte». Nombra los servidores y las aplicaciones que dependen de él, y cada ficha de aplicación indica su responsable y su criticidad. La conversación sobre la migración empieza con las personas adecuadas.

## Empezar por lo que falta

![La vista Datos que faltan: las fichas que hay que completar para que los vencimientos sean correctos.](/screenshots/end-of-support-missing-data-2026-11-07.png)

Un informe solo es tan correcto como sus datos. Un servidor sin sus tecnologías no aparecerá nunca en los vencimientos, y una versión sin fecha tampoco. Por eso el informe tiene una segunda vista, Datos que faltan, que lista lo que le impide responder:

- un servidor de base de datos que no lleva ninguna tecnología de base de datos;
- una aplicación que usa SSO sin tecnología de identidad;
- un servidor o una aplicación que usa una tecnología sin indicar qué versión;
- una máquina virtual sin host.

Cada fila abre la ficha que hay que completar. Es la parte más útil para empezar, y la más honesta: muestra dónde la cartografía aún tiene huecos.

KANAP no escanea sus servidores. Sabe lo que usted ha declarado en ellos, a mano, con un archivo CSV o mediante Netbox.

## Del informe al presupuesto

Una migración prevista para el año que viene necesita su presupuesto este año. Pase la vista a 24 meses al preparar el presupuesto: lo que termina en ese horizonte es lo que hay que cuantificar ahora.

La exportación a CSV o Excel da la lista que adjuntar a la decisión presupuestaria. Plaid, el asistente integrado en KANAP, también responde directamente: «¿Qué aplicaciones llegan al fin de soporte en los próximos seis meses?»

Una vez decidida la migración, ocupa su lugar en la misma herramienta: una línea de [presupuesto](/es/features/budget) o un proyecto, vinculados a la tecnología, al servidor o a las aplicaciones afectadas. Este vínculo se crea a mano; después permite leer en la ficha de la tecnología lo que cuesta su migración.

## Por dónde empezar

1. **Abra Datos que faltan** y complete las fichas señaladas.
2. **Pase la vista Vencimientos a 24 meses.**
3. **Despliegue las tres primeras filas** y nombre un responsable para cada migración.

Para ver el informe con datos realistas, una prueba gratuita de 14 días de nuestra versión alojada da acceso a los datos de ejemplo del grupo ficticio Fromage & Co, cargados en un minuto. KANAP es totalmente de código abierto: también puede instalarse gratis en sus propios servidores.
