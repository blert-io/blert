import {
  camelToSnake,
  camelToSnakeObject,
  snakeToCamel,
  snakeToCamelObject,
} from '../translate';

describe('camelToSnake', () => {
  it('should convert camelCase to snake_case', () => {
    expect(camelToSnake('camelCase')).toBe('camel_case');
    expect(camelToSnake('thisIsATest')).toBe('this_is_a_test');
    expect(camelToSnake('myVariableName')).toBe('my_variable_name');
  });

  it('should handle strings with no uppercase letters', () => {
    expect(camelToSnake('lowercase')).toBe('lowercase');
    expect(camelToSnake('test')).toBe('test');
  });

  it('should handle empty strings', () => {
    expect(camelToSnake('')).toBe('');
  });

  it('should handle single character strings', () => {
    expect(camelToSnake('a')).toBe('a');
    expect(camelToSnake('A')).toBe('_a');
  });
});

describe('snakeToCamel', () => {
  it('should convert snake_case to camelCase', () => {
    expect(snakeToCamel('snake_case')).toBe('snakeCase');
    expect(snakeToCamel('this_is_a_test')).toBe('thisIsATest');
    expect(snakeToCamel('my_variable_name')).toBe('myVariableName');
  });

  it('should handle strings with no underscores', () => {
    expect(snakeToCamel('lowercase')).toBe('lowercase');
    expect(snakeToCamel('test')).toBe('test');
  });

  it('should handle empty strings', () => {
    expect(snakeToCamel('')).toBe('');
  });

  it('should handle strings starting with underscore', () => {
    expect(snakeToCamel('_leading')).toBe('Leading');
  });
});

describe('camelToSnakeObject', () => {
  it('should convert object keys from camelCase to snake_case', () => {
    const input = {
      firstName: 'John',
      lastName: 'Doe',
      emailAddress: 'john@example.com',
    };
    const expected = {
      first_name: 'John',
      last_name: 'Doe',
      email_address: 'john@example.com',
    };
    expect(camelToSnakeObject(input)).toEqual(expected);
  });

  it('should handle nested objects', () => {
    const input = {
      userName: 'testUser',
      userInfo: {
        firstName: 'John',
        lastName: 'Doe',
      },
    };
    const expected = {
      user_name: 'testUser',
      user_info: {
        first_name: 'John',
        last_name: 'Doe',
      },
    };
    expect(camelToSnakeObject(input)).toEqual(expected);
  });

  it('should handle arrays', () => {
    const input = {
      userList: ['user1', 'user2'],
      numberList: [1, 2, 3],
    };
    const expected = {
      user_list: ['user1', 'user2'],
      number_list: [1, 2, 3],
    };
    expect(camelToSnakeObject(input)).toEqual(expected);
  });

  it('should handle null and undefined values', () => {
    const input = {
      nullValue: null,
      undefinedValue: undefined,
      normalValue: 'test',
    };
    const expected = {
      null_value: null,
      undefined_value: undefined,
      normal_value: 'test',
    };
    expect(camelToSnakeObject(input)).toEqual(expected);
  });

  it('should handle empty objects', () => {
    expect(camelToSnakeObject({})).toEqual({});
  });
});

describe('snakeToCamelObject', () => {
  it('should convert object keys from snake_case to camelCase', () => {
    const input = {
      first_name: 'John',
      last_name: 'Doe',
      email_address: 'john@example.com',
    };
    const expected = {
      firstName: 'John',
      lastName: 'Doe',
      emailAddress: 'john@example.com',
    };
    expect(snakeToCamelObject(input)).toEqual(expected);
  });

  it('should handle nested objects', () => {
    const input = {
      user_name: 'testUser',
      user_info: {
        first_name: 'John',
        last_name: 'Doe',
      },
    };
    const expected = {
      userName: 'testUser',
      userInfo: {
        firstName: 'John',
        lastName: 'Doe',
      },
    };
    expect(snakeToCamelObject(input)).toEqual(expected);
  });

  it('should handle arrays', () => {
    const input = {
      user_list: ['user1', 'user2'],
      number_list: [1, 2, 3],
    };
    const expected = {
      userList: ['user1', 'user2'],
      numberList: [1, 2, 3],
    };
    expect(snakeToCamelObject(input)).toEqual(expected);
  });

  it('should handle null and undefined values', () => {
    const input = {
      null_value: null,
      undefined_value: undefined,
      normal_value: 'test',
    };
    const expected = {
      nullValue: null,
      undefinedValue: undefined,
      normalValue: 'test',
    };
    expect(snakeToCamelObject(input)).toEqual(expected);
  });

  it('should handle empty objects', () => {
    expect(snakeToCamelObject({})).toEqual({});
  });
});

describe('round-trip conversions', () => {
  it('should convert back and forth between camelCase and snake_case', () => {
    const original = 'myVariableName';
    const snake = camelToSnake(original);
    const backToCamel = snakeToCamel(snake);
    expect(backToCamel).toBe(original);
  });

  it('should convert objects back and forth', () => {
    const original = {
      firstName: 'John',
      lastName: 'Doe',
      userInfo: {
        emailAddress: 'john@example.com',
        phoneNumber: '123-456-7890',
      },
    };
    const snake = camelToSnakeObject(original);
    const backToCamel = snakeToCamelObject(snake);
    expect(backToCamel).toEqual(original);
  });
});
