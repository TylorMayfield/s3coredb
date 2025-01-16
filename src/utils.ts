export function generateId(): string {
  const dt = new Date();
  const now =
    dt.getFullYear() +
    ("0" + (dt.getMonth() + 1)).slice(-2) +
    ("0" + dt.getDate()).slice(-2);
  const id = now + "-" + Math.floor(Math.random() * Math.floor(99999));
  return id;
}
