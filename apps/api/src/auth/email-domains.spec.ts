import { classifyEmail, describeDomains, parseDomains } from './email-domains';

describe('parseDomains', () => {
  it('reads one domain or a comma separated list, ignoring case, spaces and a leading @', () => {
    expect(parseDomains('adypu.edu.in')).toEqual(['adypu.edu.in']);
    expect(parseDomains('adypu.edu.in, @Gmail.com ,')).toEqual(['adypu.edu.in', 'gmail.com']);
    expect(parseDomains('')).toEqual([]);
  });

  it('describes them for an error message', () => {
    expect(describeDomains(['adypu.edu.in'])).toBe('@adypu.edu.in');
    expect(describeDomains(['adypu.edu.in', 'gmail.com'])).toBe('@adypu.edu.in or @gmail.com');
  });
});

describe('classifyEmail', () => {
  it('accepts only the college domain by default', () => {
    expect(classifyEmail('e25b0708@adypu.edu.in', ['adypu.edu.in'], 'newtonschool.co')).toBe('STUDENT');
    expect(classifyEmail('someone@gmail.com', ['adypu.edu.in'], 'newtonschool.co')).toBeNull();
    expect(classifyEmail('boss@newtonschool.co', ['adypu.edu.in'], 'newtonschool.co')).toBe('STAFF');
  });

  it('can also accept extra domains for testing, and still refuses everything else', () => {
    const domains = ['adypu.edu.in', 'gmail.com'];
    expect(classifyEmail('me.tester@gmail.com', domains, 'newtonschool.co')).toBe('STUDENT');
    expect(classifyEmail('e25b0708@adypu.edu.in', domains, 'newtonschool.co')).toBe('STUDENT');
    expect(classifyEmail('someone@yahoo.com', domains, 'newtonschool.co')).toBeNull();
    expect(classifyEmail('someone@adypu.edu.in.evil.com', domains, 'newtonschool.co')).toBeNull();
    expect(classifyEmail('a@b@gmail.com', domains, 'newtonschool.co')).toBeNull();
  });

  it('refuses odd student names', () => {
    expect(classifyEmail('.bad@adypu.edu.in', ['adypu.edu.in'], 'newtonschool.co')).toBeNull();
    expect(classifyEmail('x@adypu.edu.in', ['adypu.edu.in'], 'newtonschool.co')).toBeNull(); // too short
  });
});
