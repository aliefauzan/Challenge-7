// A message to the background that gives up. Safari can leave the extension's
// background worker stopped and not start it again for a message; the call
// then never settles. Resolves to the reply, or null after `ms` or on error.
export function ask(api, message, ms = 1000) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  const reply = Promise.resolve()
    .then(() => api.runtime.sendMessage(message))
    .catch(() => null);
  return Promise.race([reply, late]).finally(() => clearTimeout(timer));
}
