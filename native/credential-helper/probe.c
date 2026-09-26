// Test parent: emits only status/length/match, never a credential value.
#include <arpa/inet.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
#ifndef BUILD_MARKER
#define BUILD_MARKER 1
#endif
int main(int argc, char **argv) {
    if (argc != 4 && argc != 5) return 64;
    if (argc == 5) {
        if (strcmp(argv[4], "--wait-for-update")) return 64;
        puts("ready"); fflush(stdout);
        if (getchar() != '\n') return 64;
    }
    int operation = atoi(argv[2]), provider = atoi(argv[3]);
    int in[2], out[2];
    if (pipe(in) || pipe(out)) return 1;
    pid_t pid = fork();
    if (pid < 0) return 1;
    if (!pid) {
        dup2(in[0], 0); dup2(out[1], 1);
        close(in[0]); close(in[1]); close(out[0]); close(out[1]);
        execl(argv[1], argv[1], NULL); _exit(1);
    }
    close(in[0]); close(out[1]);
    const char *fixture = "synthetic-keychain-regression-value";
    size_t size = operation == 2 || operation == 6 ? strlen(fixture) : 0;
    unsigned char header[6] = {1, operation, provider, 0, size >> 8, size & 255};
    FILE *input = fdopen(in[1], "wb"), *output = fdopen(out[0], "rb");
    fwrite(header, 1, 6, input); fwrite(fixture, 1, size, input); fclose(input);
    unsigned char response[9000];
    size_t received = fread(response, 1, sizeof(response), output); fclose(output);
    int child_status; waitpid(pid, &child_status, 0);
    int status = WIFEXITED(child_status) ? WEXITSTATUS(child_status) : 99;
    if (status) { printf("denied=%d build=%d\n", status, BUILD_MARKER); return status; }
    if (received < 6) return 1;
    uint32_t code; memcpy(&code, response, 4);
    size_t length = ((size_t)response[4] << 8) | response[5];
    if (received != length + 6) return 1;
    int matches = length == strlen(fixture) && !memcmp(response + 6, fixture, length);
    printf("status=%d length=%zu matches=%d build=%d\n", (int32_t)ntohl(code), length, matches, BUILD_MARKER);
    return 0;
}
