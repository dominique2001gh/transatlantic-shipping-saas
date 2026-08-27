export interface ContactRequestInput {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

/**
 * Submits a contact form message.
 *
 * TODO(milestone 3+): replace this local simulation with a real call once
 * a public contact-intake endpoint exists on the API, e.g.
 *   return apiFetch('/contact', { method: 'POST', body: JSON.stringify(input) });
 */
export async function submitContactRequest(input: ContactRequestInput): Promise<{ success: true }> {
  void input;
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { success: true };
}
