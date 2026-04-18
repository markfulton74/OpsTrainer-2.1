# OpsTrainer Assets

Place your branding and template files here.

## Structure

```
assets/
  branding/
    logo.png          ← OpsTrainer logo (PNG, recommended 400x120px)
    logo-dark.png     ← Dark/white version for dark backgrounds
    favicon.ico       ← Browser favicon (32x32)
  
  certificates/
    template-standard.pdf    ← Standard completion certificate template
    template-excellence.pdf  ← Excellence/distinction certificate
    template-foundation.pdf  ← Foundation level certificate
```

## Certificate Templates

PDF templates should use these placeholder texts that the system replaces:
- `{{LEARNER_NAME}}` — Full name of the learner
- `{{COURSE_TITLE}}` — Name of the course completed  
- `{{COMPLETION_DATE}}` — Date of completion (DD MMMM YYYY)
- `{{CERTIFICATE_NUMBER}}` — Unique verification number
- `{{ORG_NAME}}` — Organisation name
- `{{ISSUED_BY}}` — Issuing authority

## Logo

Upload `logo.png` here. The frontend will serve it at `/assets/branding/logo.png`
and use it in the header and on certificates.

Recommended:
- Logo: PNG with transparent background, min 400px wide
- Favicon: ICO or PNG, 32×32 or 64×64
