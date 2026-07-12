import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

type EmailLocale = 'en' | 'zh';

const copy = {
  en: {
    preview: (appName: string) => `Reset your ${appName} password`,
    title: 'Reset your password',
    description: (appName: string) => (
      <>
        We received a request to reset the password for your{' '}
        <strong>{appName}</strong> account.
      </>
    ),
    action: 'Reset password',
    expires: 'This link will expire in 1 hour.',
    fallback: 'If the button does not work, copy this link into your browser:',
    ignore:
      'If you did not request a password reset, you can safely ignore this email.',
  },
  zh: {
    preview: (appName: string) => `重置你的 ${appName} 密码`,
    title: '重置密码',
    description: (appName: string) => (
      <>
        我们收到了重置你的 <strong>{appName}</strong> 账户密码的请求。
      </>
    ),
    action: '重置密码',
    expires: '此链接将在 1 小时后失效。',
    fallback: '如果按钮无法打开，请复制以下链接到浏览器：',
    ignore: '如果这不是你的操作，可以忽略此邮件，你的密码不会被修改。',
  },
} as const;

export function ResetPasswordEmail({
  appName = 'AlgoCoach',
  logoUrl,
  url,
  locale = 'en',
}: {
  appName?: string;
  logoUrl?: string;
  url: string;
  locale?: EmailLocale;
}) {
  const text = copy[locale];

  return (
    <Html>
      <Head />
      <Preview>{text.preview(appName)}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <Section style={styles.accentBar} />
            {(logoUrl || appName) && (
              <Section style={styles.brandRow}>
                {logoUrl ? (
                  <Img
                    src={logoUrl}
                    width="40"
                    height="40"
                    alt={appName}
                    style={styles.logo}
                  />
                ) : null}
                <Text style={styles.brand}>{appName}</Text>
              </Section>
            )}

            <Heading style={styles.heading}>{text.title}</Heading>
            <Text style={styles.paragraph}>{text.description(appName)}</Text>

            <Section style={styles.buttonWrap}>
              <Button href={url} style={styles.button}>
                {text.action}
              </Button>
            </Section>

            <Text style={styles.muted}>{text.expires}</Text>
            <Hr style={styles.divider} />
            <Text style={styles.small}>{text.fallback}</Text>
            <Link href={url} style={styles.link}>
              {url}
            </Link>
            <Text style={styles.footer}>{text.ignore}</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const styles: Record<string, React.CSSProperties> = {
  body: {
    margin: 0,
    padding: 0,
    backgroundColor: '#f4f7f6',
    color: '#17211f',
    fontFamily:
      '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Helvetica,Arial,sans-serif',
  },
  container: { maxWidth: 560, margin: '0 auto', padding: '32px 16px 40px' },
  card: {
    backgroundColor: '#ffffff',
    border: '1px solid #dce5e2',
    borderRadius: 8,
    padding: '28px 24px',
  },
  accentBar: {
    height: 5,
    marginBottom: 18,
    borderRadius: 4,
    backgroundColor: '#0f8b78',
  },
  brandRow: { display: 'flex', alignItems: 'center', marginBottom: 16 },
  logo: { borderRadius: 6, border: '1px solid #dce5e2' },
  brand: { margin: '10px 0 0 10px', color: '#17211f', fontWeight: 600 },
  heading: { margin: '0 0 12px', fontSize: 24, lineHeight: '32px' },
  paragraph: { margin: '0 0 18px', color: '#3d4d49', lineHeight: '22px' },
  buttonWrap: { margin: '20px 0 14px', textAlign: 'center' },
  button: {
    display: 'inline-block',
    padding: '12px 18px',
    borderRadius: 6,
    backgroundColor: '#0f8b78',
    color: '#ffffff',
    fontWeight: 600,
    textDecoration: 'none',
  },
  muted: { margin: '0 0 12px', color: '#687a75', fontSize: 12 },
  divider: { margin: '18px 0', borderColor: '#dce5e2' },
  small: { margin: '0 0 6px', color: '#687a75', fontSize: 12 },
  link: { color: '#0b6f61', fontSize: 12, wordBreak: 'break-all' },
  footer: { margin: '18px 0 0', color: '#84938f', fontSize: 12 },
};
