#import <Foundation/Foundation.h>
#import <Security/Security.h>

static int fail(NSString *message, int code) {
  fprintf(stderr, "%s\n", message.UTF8String);
  return code;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    BOOL replace = argc == 4 && strcmp(argv[1], "replace") == 0;
    BOOL add = argc == 4 && strcmp(argv[1], "add") == 0;
    if (!replace && !add) return fail(@"usage: jericho-keychain-helper <add|replace> <service> <account>", 64);
    NSString *service = [NSString stringWithUTF8String:argv[2]];
    NSString *account = [NSString stringWithUTF8String:argv[3]];
    NSData *secret = [[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
    if (!service.length || !account.length || !secret.length) return fail(@"service, account, and stdin secret are required", 65);
    NSDictionary *query = @{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
                            (__bridge id)kSecAttrService: service,
                            (__bridge id)kSecAttrAccount: account};
    OSStatus status = SecItemAdd((__bridge CFDictionaryRef)@{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
      (__bridge id)kSecAttrService: service, (__bridge id)kSecAttrAccount: account,
      (__bridge id)kSecValueData: secret, (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleAfterFirstUnlock}, NULL);
    if (status == errSecDuplicateItem && replace) {
      status = SecItemUpdate((__bridge CFDictionaryRef)query,
                             (__bridge CFDictionaryRef)@{(__bridge id)kSecValueData: secret});
    }
    if (status == errSecDuplicateItem) return fail(@"Keychain item already exists", 45);
    if (status != errSecSuccess) return fail([NSString stringWithFormat:@"Keychain write failed (%d)", (int)status], 1);
    return 0;
  }
}
