import { renderEmailTemplate } from 'src/notifications/email-templates';

describe('project-invite email template', () => {
  const view = {
    appName: 'Project & Task Management',
    subject: 'Max invited you to join Apollo',
    inviterName: 'Max Manager',
    projectName: 'Apollo <script>alert(1)</script>',
    organizationName: 'Acme',
    role: 'Developer',
    email: 'asha@example.com',
    temporaryPassword: 'Tmp4wordXyz9',
    inviteUrl: 'https://app.example.com/invite/abc_DEF-123',
    expires: 'October 14, 2026 at 9:36 AM UTC',
    year: 2026,
  };

  it('renders the link, sign-in details, steps and expiry', async () => {
    const html = await renderEmailTemplate('project-invite', view);

    expect(html).toContain('href="https://app.example.com/invite/abc_DEF-123"');
    expect(html).toContain('Tmp4wordXyz9');
    expect(html).toContain('asha@example.com');
    expect(html).toContain('Accept invitation');
    expect(html).toContain('Add your name and choose your own password.');
    expect(html).toContain('October 14, 2026 at 9:36 AM UTC');
    expect(html).toContain('in Acme');
  });

  it('HTML-escapes every value (a project name can never inject markup)', async () => {
    const html = await renderEmailTemplate('project-invite', view);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Apollo &lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('omits the organization clause when there is none', async () => {
    const html = await renderEmailTemplate('project-invite', { ...view, organizationName: null });

    expect(html).not.toContain(' in Acme');
  });
});
