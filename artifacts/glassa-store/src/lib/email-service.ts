import { CONFIG } from "./config";

type EmailParams = Record<string, string>;

export async function sendEmail(
  templateId: string,
  templateParams: EmailParams,
): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(
      "https://api.emailjs.com/api/v1.0/email/send",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: CONFIG.emailjs.serviceId,
          template_id: templateId,
          user_id: CONFIG.emailjs.publicKey,
          template_params: templateParams,
        }),
      },
    );

    if (!response.ok) {
      return {
        ok: false,
        message: `Email delivery failed (${response.status}).`,
      };
    }

    return { ok: true, message: "Email sent." };
  } catch {
    return { ok: false, message: "Email service could not be reached." };
  }
}
