---
title: "KANAP pasa a llamarse Kadratis"
description: "KANAP se llama ahora Kadratis™. El software, su licencia de código abierto y la oferta de alojamiento y soporte no cambian."
date: 2026-11-11
topic: release
author: Friedrich
authorRole: Fundador, CIO
draft: false
translationKey: kanap-devient-kadratis
---

![La página de inicio de Kadratis, con Kad en la barra superior](/screenshots/kadratis-home-2026-11-09.png)

## Por qué un nuevo nombre

De una herramienta de gobernanza se espera seriedad y rigor; pero en francés, KANAP suena sobre todo a «canap'», abreviatura de sofá. La asociación puede hacer sonreír, pero también puede resultar contraproducente.

También necesitábamos un nombre que se pudiera proteger. «Kanap» ya se usa, en el mueble y en otros sectores. Kadratis es un nombre inventado, propio del producto, y solicitado como marca. En el software de código abierto, la marca no restringe el código: simplemente permite saber cuál es la distribución oficial.

La [política de uso de la marca](https://github.com/kanap-hq/KANAP/blob/main/TRADEMARKS.md) indica lo que cada uno puede hacer con Kadratis, es decir, casi todo: hablar de él, integrarlo, alojarlo, vender servicios en torno a él…

## Qué cambia para usted

**Para todos**: el asistente de IA se llama ahora Kad. Es el mismo agente, con sus ajustes y sus conversaciones.

**En Kadratis Cloud** (el nuevo nombre de la oferta alojada):

- su espacio responde ahora en `<su-espacio>.kadratis.com`. La antigua dirección en `kanap.net` sigue funcionando, al igual que los enlaces ya enviados y las conexiones MCP;
- en su primera visita a la nueva dirección, vuelve a iniciar sesión una vez. Su navegador no siempre ofrece por sí solo la contraseña guardada para la antigua dirección: basta con escribirla. Con el inicio de sesión de Microsoft, basta un clic, como antes;
- los correos de la aplicación llevan el nuevo nombre y ahora salen de `no-reply@kadratis.com`.

**Si aloja Kadratis usted mismo**, la actualización se hace como siempre, sin pasos adicionales. A partir de la 26.11.4, las imágenes se llaman `kadratis-*` en lugar de `kanap-*`; el archivo `compose.onprem.yml` de la versión ya las nombra, y el procedimiento de actualización las descarga. Las variables `KANAP_*`, los roles de la base de datos y los tokens MCP conservan su nombre. Las versiones anteriores siguen publicadas con sus nombres antiguos.

**El sitio web y la documentación** pasan a [kadratis.com](https://kadratis.com) y [doc.kadratis.com](https://doc.kadratis.com). Las antiguas direcciones redirigen página por página.

## Qué no cambia

- **El software**: las mismas funciones, los mismos datos, la misma hoja de ruta.
- **La licencia**: AGPL v3; el código sigue siendo público y el autoalojamiento sigue siendo gratuito, sin funciones recortadas.
- **El editor**: la empresa KANAP, en Francia. Sus contratos, sus facturas y el soporte siguen a su nombre.
- **El alojamiento**: Kadratis Cloud funciona en los mismos servidores dedicados de Hetzner, en Alemania.
- **El repositorio de GitHub**: el mismo repositorio; cambiará de nombre en las próximas semanas, y GitHub redirigirá la antigua dirección.

¿Alguna pregunta sobre este cambio? Escriba a [contact@kadratis.com](mailto:contact@kadratis.com).
