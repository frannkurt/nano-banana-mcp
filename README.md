# nano-banana-mcp

**Servidor MCP para generar imágenes con Nano Banana, el modelo de imagen de [Google Flow](https://labs.google/fx/tools/flow)**,
desde Claude Code, Claude Desktop o cualquier cliente compatible — **en el tamaño exacto en píxeles que necesites**,
descargadas directo a disco. Gratis: las imágenes de Flow no consumen puntos.

```
generate_image(prompt: "un zorro naranja sobre fondo blanco", size: "1200x630")
-> imagenes/un-zorro-naranja-sobre-fondo-blanco.jpg   1200x630   0 puntos
```

> **In English:** an MCP server for Google Flow's Nano Banana image model, producing images at exact pixel dimensions.
> It attaches to a Chrome window you have already signed into, drives the prompt composer, captures the generation
> response off the wire, and crops the result to the size you asked for. It never handles your credentials, and images
> cost 0 credits. The docs, code and error messages are in Spanish.

---

## Qué resuelve

Flow genera en cinco relaciones de aspecto fijas: 16:9, 4:3, 1:1, 3:4 y 9:16. Un encargo de diseño real casi nunca cae
justo en una de ellas — un Open Graph son 1200×630, un banner de cabecera 1456×180, un avatar 400×400.

Este servidor genera en la relación nativa más cercana y recorta al tamaño exacto, usando detección de saliencia para
que el recorte no te decapite al sujeto. Le pedís `1200x630` y recibís un archivo de 1200×630.

## Cómo funciona

Flow no tiene API pública. La llamada interna de generación va firmada con un token de reCAPTCHA Enterprise que acuña el
JavaScript de la página, así que **no se puede replicar desde fuera del navegador** — y este proyecto no lo intenta.

Lo que hace es lo que haría una persona: escribe en el compositor y aprieta Enter. La diferencia está en cómo lee el
resultado. En vez de esperar a que aparezca algo nuevo en la biblioteca y adivinar cuál es, **intercepta la respuesta de
red de la propia página**, que ya trae el id del medio, las dimensiones reales y la URL firmada. Eso hace que la única
parte frágil sea escribir el prompt.

Los anclajes en la interfaz son nombres de ligature de Material Symbols (`crop_16_9`, `image`) y etiquetas numéricas
(`16:9`, `x2`). Son identificadores, no texto traducible: funciona igual con la interfaz en español, inglés o japonés.

## Requisitos

- Node.js 20 o superior
- Google Chrome instalado
- Una cuenta de Google con acceso a Flow

## Instalación

```bash
git clone https://github.com/frannkurt/nano-banana-mcp.git
cd nano-banana-mcp
npm install
npm run build
```

## Puesta en marcha

### 1. Abrí Chrome con depuración remota

Tiene que ser un perfil aparte del que usás todos los días.

**Windows**

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\.nano-banana-mcp\chrome" https://labs.google/fx/tools/flow
```

**macOS**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir="$HOME/.nano-banana-mcp/chrome" https://labs.google/fx/tools/flow
```

**Linux**

```bash
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.nano-banana-mcp/chrome" https://labs.google/fx/tools/flow
```

### 2. Iniciá sesión y abrí un proyecto

En esa ventana, entrá con tu cuenta de Google y abrí un proyecto de Flow. La URL tiene que quedar en
`labs.google/fx/tools/flow/project/<id>`.

Sin un proyecto abierto no existe el compositor, y sin compositor no se puede generar.

### 3. Registrá el servidor

En Claude Code:

```bash
claude mcp add nano-banana --env FLOW_CDP_URL=http://127.0.0.1:9222 --env FLOW_OUTPUT_DIR=./imagenes -- node /ruta/a/nano-banana-mcp/dist/index.js
```

O a mano, en la configuración de tu cliente MCP:

```json
{
  "mcpServers": {
    "nano-banana": {
      "command": "node",
      "args": ["/ruta/a/nano-banana-mcp/dist/index.js"],
      "env": {
        "FLOW_CDP_URL": "http://127.0.0.1:9222",
        "FLOW_OUTPUT_DIR": "./imagenes",
        "FLOW_MAX_COST": "0"
      }
    }
  }
}
```

### 4. Verificá

```bash
node scripts/smoke.mjs "un zorro naranja sobre fondo blanco" 1200x630
```

## Herramientas

### `flow_status`

Estado de la conexión: sesión, cuenta, proyecto abierto, saldo de puntos. Empezá por acá cuando algo falle.

### `generate_image`

| Parámetro  | Tipo                          | Por defecto        | Qué hace                                                 |
| ---------- | ----------------------------- | ------------------ | -------------------------------------------------------- |
| `prompt`   | string                        | —                  | Descripción de la imagen, en cualquier idioma             |
| `size`     | string                        | nativo             | Tamaño exacto, `"ANCHOxALTO"`, por ejemplo `"1200x630"`   |
| `aspect`   | `16:9` `4:3` `1:1` `3:4` `9:16` | derivado de `size` | Relación nativa a generar                                |
| `count`    | 1–4                           | 1                  | Cuántas variantes                                         |
| `out_dir`  | string                        | `FLOW_OUTPUT_DIR`  | Carpeta destino                                           |
| `basename` | string                        | derivado del prompt | Nombre base de los archivos                              |
| `format`   | `jpg` `png` `webp`            | `jpg`              | Formato de salida                                         |
| `fit`      | `cover` `contain`             | `cover`            | `cover` recorta para llenar, `contain` rellena los bordes |

Devuelve las rutas guardadas, el id de cada medio y una miniatura de cada resultado, para que el modelo pueda ver qué
salió y decidir si vale la pena reintentar.

### `download_image`

Baja una imagen ya existente por su id de medio, con recorte opcional. Sirve para recuperar algo generado antes o para
sacar varios tamaños del mismo original.

## Configuración

| Variable                    | Por defecto            | Qué hace                                          |
| --------------------------- | ---------------------- | ------------------------------------------------- |
| `FLOW_CDP_URL`              | `http://127.0.0.1:9222` | Endpoint de depuración del Chrome                 |
| `FLOW_OUTPUT_DIR`           | `~/nano-banana-images`        | Dónde se guardan las imágenes                     |
| `FLOW_MAX_COST`             | `0`                    | Techo de puntos por generación                    |
| `FLOW_GENERATE_TIMEOUT_MS`  | `180000`               | Cuánto esperar la respuesta de Flow               |

## Sobre el costo

Las imágenes en Flow cuestan **0 puntos**. El vídeo cuesta, y bastante.

Antes de enviar nada, el servidor lee el costo que **Flow mismo calcula** en su panel de configuración y aborta si supera
`FLOW_MAX_COST`, que viene en 0. La negativa ocurre mientras negarse todavía es gratis. Si el número no se puede leer,
tampoco envía: no adivina.

Este servidor no genera vídeo, y no está pensado para eso.

## Privacidad y credenciales

- **Nunca maneja una credencial.** Se engancha a una sesión que abriste vos a mano.
- El saldo se consulta con un token que se lee y se usa **dentro de la pestaña**. Ese token nunca cruza a este proceso,
  nunca se escribe a disco y nunca se registra.
- No se envía nada a ningún servidor que no sea Google Flow.

## Problemas frecuentes

**"No pude conectarme a Chrome"** — Chrome no está corriendo con `--remote-debugging-port=9222`, o lo abriste sin
`--user-data-dir` propio y se pegó a una instancia que ya existía. Cerrá todas las ventanas de ese perfil y volvé a
lanzarlo con el comando de arriba.

**"No hay ninguna pestaña de labs.google abierta"** — abrí Flow en esa ventana de Chrome.

**"No encontré el compositor"** — estás en la lista de proyectos, no adentro de uno. La URL tiene que incluir `/project/`.

**"No pude leer cuánto va a costar"** — la interfaz de Flow cambió. El mensaje de error incluye el texto que sí se leyó;
abrí un issue pegándolo y se arregla en un solo lugar.

**Se generó pero el recorte quedó mal** — probá `fit: "contain"`, o pedí una `aspect` explícita más cercana a tu tamaño
final en vez de dejar que se derive.

## Limitaciones

- Solo imágenes. No hay vídeo ni edición de escenas.
- Necesita una ventana de Chrome visible y logueada. No funciona headless ni en CI.
- Depende de la interfaz de Flow para escribir el prompt. Google puede cambiarla; cuando pase, se rompe el paso de envío
  y hay que ajustarlo.
- No es un producto de Google, ni está avalado ni afiliado a Google.

## Licencia

Apache-2.0. Ver [LICENSE](LICENSE).
