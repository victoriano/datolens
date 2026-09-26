#import <AppKit/AppKit.h>

static NSString *const DatolensBundleIdentifier = @"com.victoriano.datolens";

static void usage(FILE *stream) {
    fprintf(stream,
            "Usage: datolens [--] [FILE ...]\n"
            "Open CSV, XLSX, Parquet or SAV files in Datolens.\n"
            "With no files, open Datolens.\n");
}

static BOOL supported(NSURL *url) {
    static NSSet<NSString *> *extensions;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        extensions = [NSSet setWithArray:@[@"csv", @"xlsx", @"parquet", @"sav"]];
    });
    return [extensions containsObject:url.pathExtension.lowercaseString];
}

static BOOL launchDatolens(NSWorkspace *workspace) {
    NSURL *application = [workspace URLForApplicationWithBundleIdentifier:DatolensBundleIdentifier];
    if (application == nil) return NO;
    __block BOOL finished = NO;
    __block BOOL opened = NO;
    [workspace openApplicationAtURL:application
                       configuration:NSWorkspaceOpenConfiguration.configuration
                   completionHandler:^(NSRunningApplication *running, NSError *error) {
        opened = running != nil && error == nil;
        finished = YES;
    }];
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:30.0];
    while (!finished && deadline.timeIntervalSinceNow > 0) {
        [NSRunLoop.currentRunLoop runMode:NSDefaultRunLoopMode
                               beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
    }
    return finished && opened;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc == 2 && strcmp(argv[1], "--help") == 0) {
            usage(stdout);
            return 0;
        }
        if (argc == 2 && strcmp(argv[1], "--version") == 0) {
            puts("datolens 0.1.0");
            return 0;
        }

        NSMutableArray<NSURL *> *urls = [NSMutableArray array];
        BOOL optionsEnded = NO;
        for (int index = 1; index < argc; index++) {
            if (!optionsEnded && strcmp(argv[index], "--") == 0) {
                optionsEnded = YES;
                continue;
            }
            if (!optionsEnded && argv[index][0] == '-') {
                fprintf(stderr, "datolens: unknown option: %s\n", argv[index]);
                usage(stderr);
                return 64;
            }
            NSString *argument = [NSString stringWithUTF8String:argv[index]];
            if (argument == nil) {
                fputs("datolens: a file path is not valid UTF-8\n", stderr);
                return 65;
            }
            NSURL *url = [NSURL fileURLWithPath:argument].URLByStandardizingPath;
            NSError *error = nil;
            if (![url checkResourceIsReachableAndReturnError:&error]) {
                fprintf(stderr, "datolens: file not found: %s\n", argv[index]);
                return 66;
            }
            if (!supported(url)) {
                fprintf(stderr, "datolens: unsupported file type: %s\n", argv[index]);
                return 64;
            }
            [urls addObject:url];
        }

        NSWorkspace *workspace = NSWorkspace.sharedWorkspace;
        BOOL opened;
        if (urls.count == 0) {
            opened = launchDatolens(workspace);
        } else {
            opened = [workspace openURLs:urls
                 withAppBundleIdentifier:DatolensBundleIdentifier
                                 options:NSWorkspaceLaunchDefault
          additionalEventParamDescriptor:nil
                       launchIdentifiers:nil];
        }
        if (!opened) {
            fputs("datolens: Datolens is not installed or could not be opened\n", stderr);
            return 69;
        }
        return 0;
    }
}
