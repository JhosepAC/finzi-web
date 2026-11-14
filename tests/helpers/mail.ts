/** Mailpit is a local-only test inbox. No real email or provider admin key is used. */
export async function findMailLink(email: string, type: "signup" | "recovery"): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch("http://127.0.0.1:17324/api/v1/messages");
    if (!response.ok) throw new Error("No se pudo consultar el buzón local de pruebas.");
    const inbox = await response.json() as { messages: { ID: string; To: { Address: string }[] }[] };
    const candidates = inbox.messages.filter((mail) => mail.To.some((to) => to.Address.toLowerCase() === email.toLowerCase()));
    for (const mail of candidates) {
      const detail = await fetch(`http://127.0.0.1:17324/api/v1/message/${mail.ID}`);
      const body = await detail.json() as { HTML?: string; Text?: string };
      const content = (body.HTML ?? body.Text ?? "").replaceAll("&amp;", "&");
      const link = content.match(new RegExp(`http://127\\.0\\.0\\.1:3000/auth/confirm#token_hash=(?:pkce_)?[a-f0-9]+&type=${type}`))?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("No llegó el correo local de pruebas a tiempo.");
}
