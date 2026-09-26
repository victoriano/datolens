// This executable is deliberately independent of Datolens builds. macOS uses
// a cdhash partition for locally signed code, even with a stable certificate.
// Never log requests, passwords or responses. The only transport is two pipes.
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <CommonCrypto/CommonDigest.h>
#include <arpa/inet.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>

#ifndef DATOLENS_CREDENTIAL_SERVICE
#define DATOLENS_CREDENTIAL_SERVICE "com.victoriano.datolens.providers.local-v2"
#endif
#ifndef DATOLENS_LEGACY_SERVICE
#define DATOLENS_LEGACY_SERVICE "com.victoriano.datolens.providers"
#endif
#define MAX_KEY 8192

static int parent_is_datolens(void) {
    // A path, executable name, environment variable or parent PID alone is not
    // authentication. Validate the running parent's signature and requirement.
    pid_t pid = getppid();
    if (pid <= 1) return 0;
    CFNumberRef number = CFNumberCreate(NULL, kCFNumberIntType, &pid);
    const void *key = kSecGuestAttributePid, *value = number;
    CFDictionaryRef attrs = CFDictionaryCreate(NULL, &key, &value, 1,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    SecCodeRef parent = NULL, self = NULL;
    CFDictionaryRef info = NULL;
    SecRequirementRef requirement = NULL;
    CFDataRef certificate = NULL;
    CFStringRef rule = NULL;
    int allowed = 0;
    if (SecCodeCopyGuestWithAttributes(NULL, attrs, 0, &parent) ||
        SecCodeCopySelf(0, &self) ||
        SecCodeCopySigningInformation(self, kSecCSSigningInformation, &info)) goto done;
    CFArrayRef chain = CFDictionaryGetValue(info, kSecCodeInfoCertificates);
    if (!chain || !CFArrayGetCount(chain)) goto done;
    certificate = SecCertificateCopyData((SecCertificateRef)CFArrayGetValueAtIndex(chain, 0));
    if (!certificate) goto done;
    unsigned char digest[CC_SHA1_DIGEST_LENGTH];
    CC_SHA1(CFDataGetBytePtr(certificate), (CC_LONG)CFDataGetLength(certificate), digest);
    char hex[41];
    for (int i = 0; i < 20; i++) snprintf(hex + i * 2, 3, "%02x", digest[i]);
    char text[512];
    // The Apple clause supports the already established Datolens distribution
    // team. Local builds must have the exact same certificate as this helper.
    snprintf(text, sizeof(text), "identifier \"com.victoriano.datolens\" and "
        "(certificate leaf = H\"%s\" or (anchor apple generic and "
        "certificate leaf[subject.OU] = \"CW546NZ5HC\"))", hex);
    rule = CFStringCreateWithCString(NULL, text, kCFStringEncodingUTF8);
    if (SecRequirementCreateWithString(rule, 0, &requirement)) goto done;
    allowed = SecCodeCheckValidity(parent, kSecCSStrictValidate, requirement) == errSecSuccess
        && getppid() == pid;
    if (allowed) {
        CFDictionaryRef parent_info = NULL;
        allowed = SecCodeCopySigningInformation(parent, kSecCSSigningInformation, &parent_info) == 0;
        if (parent_info) {
            uint32_t flags = 0;
            CFNumberRef value = CFDictionaryGetValue(parent_info, kSecCodeInfoFlags);
            if (value) CFNumberGetValue(value, kCFNumberSInt32Type, &flags);
            allowed = allowed && (flags & kSecCodeSignatureRuntime);
            CFDictionaryRef entitlements = CFDictionaryGetValue(parent_info, kSecCodeInfoEntitlementsDict);
            if (entitlements && (CFDictionaryGetValue(entitlements, CFSTR("com.apple.security.get-task-allow")) == kCFBooleanTrue ||
                CFDictionaryGetValue(entitlements, CFSTR("com.apple.security.cs.allow-dyld-environment-variables")) == kCFBooleanTrue)) allowed = 0;
            CFRelease(parent_info);
        }
    }
done:
    if (rule) CFRelease(rule);
    if (certificate) CFRelease(certificate);
    if (requirement) CFRelease(requirement);
    if (info) CFRelease(info);
    if (self) CFRelease(self);
    if (parent) CFRelease(parent);
    CFRelease(attrs); CFRelease(number);
    return allowed;
}

static CFMutableDictionaryRef query(const char *service, CFStringRef account) {
    CFMutableDictionaryRef q = CFDictionaryCreateMutable(NULL, 0,
        &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    CFStringRef name = CFStringCreateWithCString(NULL, service, kCFStringEncodingUTF8);
    CFDictionarySetValue(q, kSecClass, kSecClassGenericPassword);
    CFDictionarySetValue(q, kSecAttrService, name);
    CFDictionarySetValue(q, kSecAttrAccount, account);
    CFRelease(name);
    return q;
}

static OSStatus read_key(const char *service, CFStringRef account, int interactive, CFDataRef *data) {
    SecKeychainSetUserInteractionAllowed(interactive);
    CFMutableDictionaryRef q = query(service, account);
    CFDictionarySetValue(q, kSecReturnData, kCFBooleanTrue);
    CFDictionarySetValue(q, kSecMatchLimit, kSecMatchLimitOne);
    OSStatus status = SecItemCopyMatching(q, (CFTypeRef *)data);
    CFRelease(q);
    if (!status && (!*data || CFGetTypeID(*data) != CFDataGetTypeID())) return errSecDecode;
    return status;
}

static OSStatus save_at(const char *service, CFStringRef account, CFDataRef data) {
    CFMutableDictionaryRef q = query(service, account);
    // Default creation ACL trusts this helper only. Never use an all-apps ACL.
    CFDictionarySetValue(q, kSecValueData, data);
    OSStatus status = SecItemAdd(q, NULL);
    if (status == errSecDuplicateItem) {
        CFDictionaryRemoveValue(q, kSecValueData);
        const void *key = kSecValueData, *value = data;
        CFDictionaryRef update = CFDictionaryCreate(NULL, &key, &value, 1,
            &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
        status = SecItemUpdate(q, update);
        CFRelease(update);
    }
    CFRelease(q);
    return status;
}

static OSStatus save_key(CFStringRef account, CFDataRef data) {
    return save_at(DATOLENS_CREDENTIAL_SERVICE, account, data);
}

static OSStatus has_key(const char *service, CFStringRef account) {
    SecKeychainSetUserInteractionAllowed(false);
    CFMutableDictionaryRef q = query(service, account);
    CFDictionarySetValue(q, kSecReturnAttributes, kCFBooleanTrue);
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching(q, &result);
    if (result) CFRelease(result);
    CFRelease(q);
    return status;
}

static OSStatus remove_key(const char *service, CFStringRef account) {
    CFMutableDictionaryRef q = query(service, account);
    OSStatus status = SecItemDelete(q);
    CFRelease(q);
    return status == errSecItemNotFound ? errSecSuccess : status;
}

int main(void) {
    struct rlimit no_core = {0, 0};
    setrlimit(RLIMIT_CORE, &no_core);
    struct stat input, output;
    if (fstat(0, &input) || fstat(1, &output) || !S_ISFIFO(input.st_mode) ||
        !S_ISFIFO(output.st_mode) || !parent_is_datolens()) return 77;
    // Request: version, operation, provider, reserved, u16 big-endian length.
    unsigned char header[6], secret[MAX_KEY] = {0};
    int max_operation = 5;
#ifdef DATOLENS_HELPER_TEST
    max_operation = 6;
#endif
    if (fread(header, 1, 6, stdin) != 6 || header[0] != 1 || header[3] != 0 ||
        header[2] > 1 || header[1] < 1 || header[1] > max_operation) return 64;
    size_t length = ((size_t)header[4] << 8) | header[5];
    int writing = header[1] == 2 || header[1] == 6;
    if (length > MAX_KEY || (!writing && length) ||
        (writing && !length) || fread(secret, 1, length, stdin) != length) return 64;
    CFStringRef account = header[2] == 0 ? CFSTR("gemini") : CFSTR("jev");
    CFDataRef data = NULL;
    OSStatus status = errSecSuccess;
    switch (header[1]) {
    case 1: // Normal call: existing v2 items never open an authorization dialog.
    case 5: // Explicit Settings retry may unlock a locked Keychain.
        status = read_key(DATOLENS_CREDENTIAL_SERVICE, account, header[1] == 5, &data);
        if (status == errSecItemNotFound) {
            // One-time transfer. A single Allow suffices: the new item is owned
            // by this unchanged helper. Preserve the old item for rollback.
            status = read_key(DATOLENS_LEGACY_SERVICE, account, true, &data);
            if (!status) {
                status = save_key(account, data);
                if (!status) {
                    CFDataRef verify = NULL;
                    status = read_key(DATOLENS_CREDENTIAL_SERVICE, account, false, &verify);
                    if (!status && !CFEqual(data, verify)) status = errSecDecode;
                    if (verify) CFRelease(verify);
                }
            }
        }
        break;
    case 2:
        SecKeychainSetUserInteractionAllowed(true);
        data = CFDataCreate(NULL, secret, (CFIndex)length);
        status = save_key(account, data);
        CFRelease(data); data = NULL;
        break;
    case 3:
        status = has_key(DATOLENS_CREDENTIAL_SERVICE, account);
        if (status == errSecItemNotFound) status = has_key(DATOLENS_LEGACY_SERVICE, account);
        break;
    case 4:
        SecKeychainSetUserInteractionAllowed(true);
        // Delete the rollback item first; a failed removal must not resurrect it.
        status = remove_key(DATOLENS_LEGACY_SERVICE, account);
        if (!status) status = remove_key(DATOLENS_CREDENTIAL_SERVICE, account);
        break;
#ifdef DATOLENS_HELPER_TEST
    case 6:
        // Test-only legacy fixture, in a unique test namespace. Never compiled
        // into the shipping helper and never touches a user's provider entry.
        data = CFDataCreate(NULL, secret, (CFIndex)length);
        status = save_at(DATOLENS_LEGACY_SERVICE, account, data);
        CFRelease(data); data = NULL;
        break;
#endif
    }
    for (volatile unsigned char *p = secret; p < secret + sizeof(secret); p++) *p = 0;
    size_t size = !status && data ? (size_t)CFDataGetLength(data) : 0;
    if (size > MAX_KEY) { status = errSecDecode; size = 0; }
    uint32_t code = htonl((uint32_t)status);
    unsigned char size_bytes[2] = {size >> 8, size & 255};
    fwrite(&code, 1, 4, stdout); fwrite(size_bytes, 1, 2, stdout);
    if (size) fwrite(CFDataGetBytePtr(data), 1, size, stdout);
    fflush(stdout);
    if (data) CFRelease(data);
    return 0;
}
