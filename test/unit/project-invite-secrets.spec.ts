import { generateTemporaryPassword } from 'src/modules/project-invites/project-invites.service';
import { redactEmailPayload } from 'src/notifications/logging-email.service';

describe('project invite secrets', () => {
  it('generates 12-character temporary passwords that always meet the password policy', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const password = generateTemporaryPassword();
      expect(password).toMatch(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z2-9]{12}$/);
      expect(password).not.toMatch(/[01OIl]/);
      seen.add(password);
    }
    expect(seen.size).toBe(500);
  });

  it('masks the temporary password everywhere in a logged email', () => {
    const logged = redactEmailPayload({
      to: 'a@example.com',
      subject: 'Invite',
      template: 'project-invite',
      redact: ['Secret123abc'],
      data: { text: 'Temporary password: Secret123abc\nlink' },
    });

    expect(JSON.stringify(logged)).not.toContain('Secret123abc');
    expect(logged.data.text).toBe('Temporary password: [REDACTED]\nlink');
    expect('redact' in logged).toBe(false);
  });
});
