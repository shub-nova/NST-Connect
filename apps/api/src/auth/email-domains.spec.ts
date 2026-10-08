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
    expect(classifyEmail('e25b0708@adypu.edu.in', ['adypu.edu.in'], ['newtonschool.co'])).toBe('STUDENT');
    expect(classifyEmail('someone@gmail.com', ['adypu.edu.in'], ['newtonschool.co'])).toBeNull();
    expect(classifyEmail('boss@newtonschool.co', ['adypu.edu.in'], ['newtonschool.co'])).toBe('STAFF');
  });

  it('can also accept extra domains for testing, and still refuses everything else', () => {
    const domains = ['adypu.edu.in', 'gmail.com'];
    expect(classifyEmail('me.tester@gmail.com', domains, ['newtonschool.co'])).toBe('STUDENT');
    expect(classifyEmail('e25b0708@adypu.edu.in', domains, ['newtonschool.co'])).toBe('STUDENT');
    expect(classifyEmail('someone@yahoo.com', domains, ['newtonschool.co'])).toBeNull();
    expect(classifyEmail('someone@adypu.edu.in.evil.com', domains, ['newtonschool.co'])).toBeNull();
    expect(classifyEmail('a@b@gmail.com', domains, ['newtonschool.co'])).toBeNull();
  });

  it('refuses odd student names', () => {
    expect(classifyEmail('.bad@adypu.edu.in', ['adypu.edu.in'], ['newtonschool.co'])).toBeNull();
    expect(classifyEmail('x@adypu.edu.in', ['adypu.edu.in'], ['newtonschool.co'])).toBeNull(); // too short
  });
});

describe('staff test domains', () => {
  it('accepts extra staff domains', () => {
    expect(classifyEmail('lead@outlook.com', ['adypu.edu.in', 'gmail.com'], ['newtonschool.co', 'outlook.com'])).toBe('STAFF');
    expect(classifyEmail('lead@yahoo.com', ['adypu.edu.in', 'gmail.com'], ['newtonschool.co', 'outlook.com'])).toBeNull();
  });

  it('tells apart a shared test domain by a +staff tag', () => {
    const students = ['adypu.edu.in', 'gmail.com'];
    const staff = ['newtonschool.co', 'gmail.com'];
    expect(classifyEmail('me.tester@gmail.com', students, staff)).toBe('STUDENT');
    expect(classifyEmail('me.tester+staff@gmail.com', students, staff)).toBe('STAFF');
    expect(classifyEmail('+staff@gmail.com', students, staff)).toBeNull();
    expect(classifyEmail('me+other@gmail.com', students, staff)).toBeNull();
    expect(classifyEmail('boss@newtonschool.co', students, staff)).toBe('STAFF');
  });
});
