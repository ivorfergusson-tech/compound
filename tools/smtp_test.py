"""Sends one test email through Brevo SMTP, to check the login and key Supabase uses.

Put these in .env (never commit it):
    BREVO_SMTP_LOGIN=...@smtp-brevo.com
    BREVO_SMTP_KEY=...
    BREVO_SENDER=ivorfergusson@gmail.com
Run: python tools/smtp_test.py [to@example.com] [--env path/to/.env]
"""
import smtplib
import sys
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def env(path):
    out = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def main():
    args = sys.argv[1:]
    path = ROOT / ".env"
    if "--env" in args:
        i = args.index("--env")
        path = args[i + 1]
        del args[i:i + 2]
    e = env(path)
    missing = [k for k in ("BREVO_SMTP_LOGIN", "BREVO_SMTP_KEY", "BREVO_SENDER") if not e.get(k)]
    if missing:
        sys.exit(f"Add to .env: {', '.join(missing)}")
    to = args[0] if args else e["BREVO_SENDER"]

    msg = EmailMessage()
    msg["From"] = f"Compound <{e['BREVO_SENDER']}>"
    msg["To"] = to
    msg["Subject"] = "Compound SMTP test"
    msg.set_content("If you can read this, Brevo SMTP works with these details.")

    for port in (587, 2525):
        print(f"Port {port}: ", end="", flush=True)
        try:
            with smtplib.SMTP("smtp-relay.brevo.com", port, timeout=15) as s:
                s.starttls()
                s.login(e["BREVO_SMTP_LOGIN"], e["BREVO_SMTP_KEY"])
                s.send_message(msg)
            print(f"sent to {to}. The login, key and sender are fine.")
            return
        except smtplib.SMTPAuthenticationError as err:
            sys.exit(f"login or key rejected ({err.smtp_code}). Copy both again from Brevo → SMTP & API.")
        except smtplib.SMTPSenderRefused as err:
            sys.exit(f"sender refused ({err.smtp_code} {err.smtp_error.decode(errors='replace')}).")
        except Exception as err:  # connection problems: try the other port
            print(f"failed ({type(err).__name__}: {err})")
    sys.exit("Couldn't connect on either port.")


if __name__ == "__main__":
    main()
