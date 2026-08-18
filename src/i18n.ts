/**
 * IDIOMA DE LOS MENSAJES
 *
 * Dos idiomas distintos se cruzan en este proyecto y conviene no confundirlos:
 *
 *   1. El idioma de la INTERFAZ de Flow, que decide el usuario en su cuenta de
 *      Google. El conector nunca depende de él: ancla en ligatures de Material
 *      Symbols y etiquetas numéricas, que son identificadores y no se traducen.
 *
 *   2. El idioma de lo que ESTE servidor dice — errores, avisos, estado. Es lo
 *      que se resuelve acá.
 *
 * Se elige por `FLOW_LANG`, y si no está, por el locale del sistema. El valor por
 * defecto es inglés porque es lo que más gente entiende, no porque sea mejor.
 *
 * Los mensajes son funciones y no plantillas con marcadores: así el compilador
 * obliga a pasar los mismos datos en los dos idiomas, y una traducción que se
 * olvida un dato no compila en vez de imprimir "undefined" en producción.
 */

export type Lang = "en" | "es";

function detect(): Lang {
  const forced = (process.env["FLOW_LANG"] ?? "").toLowerCase();
  if (forced.startsWith("es")) return "es";
  if (forced.startsWith("en")) return "en";

  const sistema = (
    process.env["LC_ALL"] ??
    process.env["LC_MESSAGES"] ??
    process.env["LANG"] ??
    ""
  ).toLowerCase();
  return sistema.startsWith("es") ? "es" : "en";
}

export const lang: Lang = detect();

/** Elige la variante del idioma activo. */
function p(v: { en: string; es: string }): string {
  return v[lang];
}

export const M = {
  // ---- browser.ts ----
  chromeUnreachable: (url: string, why: string) =>
    p({
      en: `Couldn't connect to Chrome at ${url}: ${why}`,
      es: `No pude conectarme a Chrome en ${url}: ${why}`,
    }),
  chromeUnreachableHint: () =>
    p({
      en: "Launch Chrome with --remote-debugging-port=9222 and its own --user-data-dir, then open labs.google/fx/tools/flow. See the README.",
      es: "Abrí Chrome con --remote-debugging-port=9222 y un --user-data-dir propio, después entrá a labs.google/fx/tools/flow. Ver el README.",
    }),
  noContext: () =>
    p({
      en: "Chrome answered but has no open context.",
      es: "Chrome respondió pero no tiene ningún contexto abierto.",
    }),
  noFlowTab: () =>
    p({
      en: "No labs.google tab is open in that Chrome.",
      es: "No hay ninguna pestaña de labs.google abierta en ese Chrome.",
    }),
  noFlowTabHint: () =>
    p({
      en: "Go to labs.google/fx/tools/flow, sign in and open a project.",
      es: "Entrá a labs.google/fx/tools/flow, iniciá sesión y abrí un proyecto.",
    }),
  noProjectTab: () =>
    p({
      en: "No tab has a Flow project open.",
      es: "No hay ninguna pestaña con un proyecto de Flow abierto.",
    }),
  noProjectTabHint: () =>
    p({
      en: "Open a project at labs.google/fx/tools/flow before generating.",
      es: "Abrí un proyecto en labs.google/fx/tools/flow antes de generar.",
    }),

  // ---- ui.ts ----
  noSettingsControl: () =>
    p({
      en: "Couldn't find the generation settings control on the page.",
      es: "No encontré el control de configuración de generación en la página.",
    }),
  noSettingsControlHint: () =>
    p({
      en: "Check that a Flow project is open (labs.google/fx/tools/flow/project/<id>) and that the window isn't covered.",
      es: "Confirmá que hay un proyecto de Flow abierto (labs.google/fx/tools/flow/project/<id>) y que la ventana no está tapada.",
    }),
  settingsWontOpen: () =>
    p({
      en: "Clicked the settings control but the panel didn't open.",
      es: "Hice clic en el control de configuración pero el panel no se abrió.",
    }),
  noOption: (what: string) =>
    p({
      en: `Couldn't find the ${what} option in the settings panel.`,
      es: `No encontré la opción de ${what} en el panel de configuración.`,
    }),
  visibleTabs: (tabs: string) =>
    p({
      en: `Visible tabs: ${tabs || "(none)"}`,
      es: `Pestañas visibles: ${tabs || "(ninguna)"}`,
    }),
  optionMediaType: () => p({ en: "media type (image)", es: "tipo de medio (imagen)" }),
  optionAspect: (a: string) => p({ en: `aspect ratio ${a}`, es: `relación de aspecto ${a}` }),
  optionCount: (n: number) => p({ en: `output count (x${n})`, es: `cantidad de salidas (x${n})` }),
  noComposer: () =>
    p({
      en: "Couldn't find the prompt composer on the page.",
      es: "No encontré el compositor de prompts en la página.",
    }),
  noComposerHint: () =>
    p({
      en: "Open a Flow project (labs.google/fx/tools/flow/project/<id>) before generating.",
      es: "Abrí un proyecto de Flow (labs.google/fx/tools/flow/project/<id>) antes de generar.",
    }),

  // ---- reference.ts ----
  noFileInput: () =>
    p({
      en: "Couldn't find the file upload field on the Flow page.",
      es: "No encontré el campo de subida de archivos en la página de Flow.",
    }),
  noFileInputHint: () =>
    p({
      en: "Check that a project is open. If the interface changed, please open an issue.",
      es: "Confirmá que hay un proyecto abierto. Si la interfaz cambió, abrí un issue.",
    }),
  uploadUnconfirmed: (file: string) =>
    p({
      en: `Uploaded ${file} but Flow never confirmed it.`,
      es: `Subí ${file} pero Flow no confirmó la carga.`,
    }),
  uploadUnconfirmedHint: () =>
    p({ en: "Check the browser window.", es: "Revisá la ventana del navegador." }),
  uploadFailed: (status: number, file: string) =>
    p({
      en: `Flow returned ${status} while uploading ${file}.`,
      es: `Flow devolvió ${status} al subir ${file}.`,
    }),
  uploadNoId: (file: string) =>
    p({
      en: `Flow accepted ${file} but returned no media identifier.`,
      es: `Flow aceptó ${file} pero no devolvió un identificador de medio.`,
    }),
  noAttachControl: () =>
    p({
      en: "Couldn't find the control to attach media next to the composer.",
      es: "No encontré el control para adjuntar medios junto al compositor.",
    }),
  notInLibrary: (file: string) =>
    p({
      en: `Couldn't find ${file} in the library picker.`,
      es: `No encontré ${file} en el selector de la biblioteca.`,
    }),
  notInLibraryHint: () =>
    p({
      en: "If you just uploaded it, Flow may not have indexed it yet; if the name is from an old file, check it's still in the project.",
      es: "Si recién lo subiste puede que Flow aún no lo haya indexado; si el nombre es de un archivo viejo, revisá que siga en el proyecto.",
    }),
  notAttached: (file: string) =>
    p({
      en: `Selected ${file} in the library but it didn't attach to the composer.`,
      es: `Elegí ${file} en la biblioteca pero no quedó adjunto al compositor.`,
    }),
  notAttachedHint: () =>
    p({
      en: "Flow may have changed the picker's confirm button. Please open an issue.",
      es: "Puede que Flow haya cambiado el botón de confirmar del selector. Abrí un issue.",
    }),

  // ---- generate.ts ----
  generateFailed: (status: number) =>
    p({ en: `Flow returned ${status} while generating.`, es: `Flow devolvió ${status} al generar.` }),
  emptyBody: () => p({ en: "No response body.", es: "Sin cuerpo en la respuesta." }),
  noAnswer: (secs: number) =>
    p({
      en: `Prompt sent but Flow didn't answer within ${secs}s.`,
      es: `Envié el prompt pero Flow no respondió en ${secs}s.`,
    }),
  noAnswerHint: () =>
    p({
      en: "Check the browser window: there may be an error banner, a usage limit, or a re-authentication prompt. Don't blindly resend.",
      es: "Mirá la ventana del navegador: puede haber un cartel de error, un límite de uso o un pedido de reautenticación. No reenvíes a ciegas.",
    }),
  costUnreadable: () =>
    p({
      en: "I couldn't read what this generation would cost, so I'm not sending it.",
      es: "No pude leer cuánto va a costar esta generación, así que no la envío.",
    }),
  costUnreadableHint: (raw: string) =>
    p({
      en: `The panel read: "${raw}". If Flow's interface changed, please open an issue with that text.`,
      es: `El panel decía: "${raw}". Si la interfaz de Flow cambió, abrí un issue con ese texto.`,
    }),
  costTooHigh: (cost: number, max: number) =>
    p({
      en: `Flow quotes ${cost} credits and the configured ceiling is ${max}. Nothing was sent, nothing was spent.`,
      es: `Flow cotiza ${cost} puntos y el techo configurado es ${max}. No envié nada, no se gastó nada.`,
    }),
  costTooHighHintZero: () =>
    p({
      en: "This server is limited to free generations. Images cost 0; if this quotes more, check the panel is in image mode.",
      es: "Este servidor viene limitado a generaciones gratuitas. Las imágenes cuestan 0; si esto cotiza más, revisá que el panel haya quedado en modo imagen.",
    }),
  costTooHighHint: () =>
    p({
      en: "Only raise FLOW_MAX_COST if you know what you're spending.",
      es: "Subí FLOW_MAX_COST solo si sabés lo que estás gastando.",
    }),
  noImages: () =>
    p({
      en: "Flow answered successfully but returned no image.",
      es: "Flow respondió correctamente pero no vino ninguna imagen.",
    }),
  noImagesHint: () =>
    p({
      en: "It may have rejected the prompt on content policy. Check the chat in the browser.",
      es: "Puede haber rechazado el prompt por políticas de contenido. Revisá el chat en el navegador.",
    }),

  // ---- download.ts ----
  downloadFailed: (mediaId: string) =>
    p({ en: `Couldn't download media ${mediaId}.`, es: `No pude descargar el medio ${mediaId}.` }),

  // ---- types.ts ----
  badSize: (size: string) =>
    p({
      en: `Invalid size: "${size}". Use the WIDTHxHEIGHT format, e.g. 1200x630.`,
      es: `Tamaño inválido: "${size}". Usá el formato ANCHOxALTO, por ejemplo 1200x630.`,
    }),
  sizeOutOfRange: (w: number, h: number) =>
    p({
      en: `Size out of range: ${w}x${h}. Allowed between 16 and 8192 px per side.`,
      es: `Tamaño fuera de rango: ${w}x${h}. Permitido entre 16 y 8192 px por lado.`,
    }),

  // ---- index.ts ----
  statusBrowser: (url: string) => p({ en: `Browser:   connected (${url})`, es: `Navegador:  conectado (${url})` }),
  statusSession: (who: string | null) =>
    who
      ? p({ en: `Session:   signed in as ${who}`, es: `Sesión:     iniciada como ${who}` })
      : p({ en: "Session:   NOT SIGNED IN", es: "Sesión:     SIN INICIAR" }),
  statusProject: (id: string | null) =>
    p({
      en: `Project:   ${id ?? "none open"}`,
      es: `Proyecto:   ${id ?? "ninguno abierto"}`,
    }),
  statusCredits: (credits: number | null, tier: string | null) =>
    p({
      en: `Balance:   ${credits ?? "unknown"} credits${tier ? ` (${tier})` : ""}`,
      es: `Saldo:      ${credits ?? "desconocido"} puntos${tier ? ` (${tier})` : ""}`,
    }),
  statusCeiling: (max: number) =>
    p({ en: `Ceiling:   ${max} credits per generation`, es: `Techo:      ${max} puntos por generación` }),
  statusOutput: (dir: string) => p({ en: `Output:    ${dir}`, es: `Salida:     ${dir}` }),
  statusNoProject: () =>
    p({
      en: "Open a project in Flow: without one there is no composer and nothing can be generated.",
      es: "Abrí un proyecto en Flow: sin proyecto no existe el compositor y no se puede generar.",
    }),
  resultHeader: (n: number, cost: number | null) =>
    p({
      en: `${n} image(s) generated. Cost: ${cost} credits.`,
      es: `${n} imagen(es) generada(s). Costo: ${cost} puntos.`,
    }),
  resultNative: (aspect: string, w: number, h: number) =>
    p({
      en: `Native ratio: ${aspect} (Flow returned ${w}x${h})`,
      es: `Relación nativa: ${aspect} (Flow devolvió ${w}x${h})`,
    }),
  resultCropped: (w: number, h: number, fit: string) =>
    p({
      en: `Cropped to ${w}x${h} with fit=${fit}.`,
      es: `Recortadas a ${w}x${h} con fit=${fit}.`,
    }),
  resultNative0: () => p({ en: "No crop: native size.", es: "Sin recorte: tamaño nativo." }),
  upscaleWarning: (tw: number, th: number, nw: number, nh: number) =>
    p({
      en:
        `Warning: ${tw}x${th} is larger than Flow's native ${nw}x${nh}. The image was enlarged: those extra` +
        ` pixels are interpolated, not generated. For real detail, ask for a size within the native one.`,
      es:
        `Aviso: ${tw}x${th} es más grande que el nativo de Flow (${nw}x${nh}). La imagen se amplió: esos píxeles` +
        ` de más son interpolados, no generados. Para más detalle real, pedí un tamaño dentro del nativo.`,
    }),
  effectivePrompt: (prompt: string) =>
    p({
      en: `Effective prompt Flow used: ${prompt}`,
      es: `Prompt efectivo que usó Flow: ${prompt}`,
    }),
  savedAs: (file: string, w: number, h: number, kb: number) =>
    p({
      en: `Saved to ${file} (${w}x${h}, ${kb} KB)`,
      es: `Guardada en ${file} (${w}x${h}, ${kb} KB)`,
    }),
  // ---- descripciones de las herramientas MCP ----
  // Las lee el modelo del otro lado del protocolo, así que también se localizan:
  // son la superficie visible del servidor, no comentarios internos.
  toolStatus: () =>
    p({
      en: "Check the connection to the Google Flow Chrome window: signed-in session, account, open project and credit balance. Call this first when something fails.",
      es: "Comprueba la conexión con el Chrome de Google Flow: sesión iniciada, cuenta, proyecto abierto y saldo de puntos. Llamalo primero si algo falla.",
    }),
  toolGenerate: () =>
    p({
      en: "Generate one or more images with Google Flow and save them to disk. You can ask for an exact pixel size (e.g. 1200x630): it generates at the closest native aspect ratio and crops to the size you asked for. Images cost no credits.",
      es: "Genera una o varias imágenes con Google Flow y las guarda en disco. Podés pedir un tamaño exacto en píxeles (por ejemplo 1200x630): se genera en la relación de aspecto nativa más cercana y se recorta al tamaño pedido. Las imágenes no consumen puntos.",
    }),
  toolDownload: () =>
    p({
      en: "Download an image that already exists in Flow by its media id, with optional cropping to an exact size.",
      es: "Descarga una imagen ya existente en Flow a partir de su id de medio, con recorte opcional a un tamaño exacto.",
    }),
  argPrompt: () =>
    p({ en: "Image description. In any language.", es: "Descripción de la imagen. En cualquier idioma." }),
  argSize: () =>
    p({
      en: 'Exact output size, "WIDTHxHEIGHT" format, e.g. "1200x630". Omit to use the native size.',
      es: 'Tamaño exacto de salida, formato "ANCHOxALTO", por ejemplo "1200x630". Si se omite, se usa el nativo.',
    }),
  argAspect: () =>
    p({
      en: "Native aspect ratio. If omitted and `size` is given, the closest one is chosen.",
      es: "Relación de aspecto nativa. Si se omite y hay `size`, se elige la más cercana.",
    }),
  argCount: () => p({ en: "How many variants to generate (1 to 4).", es: "Cuántas variantes generar (1 a 4)." }),
  argReferenceImages: () =>
    p({
      en:
        "Local paths to images to use as references. Flow starts from them instead of from scratch, so the prompt " +
        "describes what to change rather than what to create. Useful for versioning a logo, iterating on a previous " +
        "result, or holding a style across pieces.",
      es:
        "Rutas locales de imágenes a usar como referencia. Flow parte de ellas en vez de partir de cero, así que el " +
        "prompt pasa a describir qué cambiar y no qué crear. Sirve para versionar un logo, iterar sobre un resultado " +
        "anterior, o sostener un estilo entre piezas.",
    }),
  argReferenceLibrary: () =>
    p({
      en:
        "Filenames ALREADY in the project library, to attach without uploading them again. Use this when iterating " +
        "on the same reference: re-uploading the same file only leaves duplicate rows in the library and makes each " +
        "generation slower.",
      es:
        "Nombres de archivos que YA están en la biblioteca del proyecto, para adjuntarlos sin volver a subirlos. " +
        "Usalo al iterar sobre la misma referencia: subir el mismo archivo en cada vuelta sólo deja filas duplicadas " +
        "en la biblioteca y hace más lenta cada generación.",
    }),
  argOutDir: () =>
    p({
      en: "Destination folder. Defaults to FLOW_OUTPUT_DIR.",
      es: "Carpeta destino. Por defecto, la configurada en FLOW_OUTPUT_DIR.",
    }),
  argBasename: () =>
    p({
      en: "Base filename. Derived from the prompt by default.",
      es: "Nombre base de los archivos. Por defecto se deriva del prompt.",
    }),
  argFormat: () => p({ en: "Output format.", es: "Formato de salida." }),
  argFit: () =>
    p({
      en: 'How to fit into `size`: "cover" crops to fill, "contain" fits everything and pads the edges.',
      es: 'Cómo encajar en `size`: "cover" recorta para llenar, "contain" mete todo y rellena bordes.',
    }),
  argBackground: () =>
    p({
      en: 'Padding color for fit="contain", as a CSS color ("#0f172a", "black"). White by default.',
      es: 'Color de relleno para fit="contain", como color CSS ("#0f172a", "black"). Blanco por defecto.',
    }),
  argMediaId: () =>
    p({ en: "Media id, as returned by generate_image.", es: "Id del medio, tal como lo devuelve generate_image." }),
  argOutFile: () =>
    p({
      en: "Output path. The extension decides the format.",
      es: "Ruta de salida. La extensión decide el formato.",
    }),
  argSizePlain: () => p({ en: 'Exact size, "WIDTHxHEIGHT" format.', es: 'Tamaño exacto, formato "ANCHOxALTO".' }),

  ready: (cdp: string, out: string, max: number) =>
    p({
      en: `nano-banana-mcp ready — CDP ${cdp}, output ${out}, ceiling ${max} credits`,
      es: `nano-banana-mcp listo — CDP ${cdp}, salida ${out}, techo ${max} puntos`,
    }),
} as const;
