// netlify/functions/officeSignal.js
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ ok: false, error: "method_not_allowed" }) };
    }

    const API_BASE_URL = process.env.API_BASE_URL; // Render URL
    const OFFICE_API_SECRET = process.env.OFFICE_API_SECRET; // fica no server da Netlify

    if (!API_BASE_URL || !OFFICE_API_SECRET) {
      return { statusCode: 500, body: JSON.stringify({ ok: false, error: "missing_env" }) };
    }

    const body = event.body ? JSON.parse(event.body) : {};

    const resp = await fetch(`${API_BASE_URL}/office/signal`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Office-Secret": OFFICE_API_SECRET,
      },
      body: JSON.stringify(body),
    });

    const json = await resp.json().catch(() => null);

    return {
      statusCode: resp.status,
      body: JSON.stringify(json || { ok: false, error: "bad_response" }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: "server_error" }) };
  }
}
