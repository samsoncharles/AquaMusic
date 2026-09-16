#define UNICODE
#define _UNICODE
#include <windows.h>
#include <shlwapi.h>
#include <shellapi.h>
#include <stdio.h>
#include <wchar.h>

static int FileExists(const wchar_t* path) {
    DWORD attr;
    if (!path || path[0] == L'\0') return 0;
    attr = GetFileAttributesW(path);
    return (attr != INVALID_FILE_ATTRIBUTES && !(attr & FILE_ATTRIBUTE_DIRECTORY));
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    wchar_t exePath[MAX_PATH];
    wchar_t exeDir[MAX_PATH];
    wchar_t scriptPath[MAX_PATH];
    wchar_t pythonPath[MAX_PATH];
    wchar_t cmdLine[MAX_PATH * 3];
    wchar_t* lastSlash = NULL;
    int i;
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;

    ZeroMemory(exePath, sizeof(exePath));
    ZeroMemory(exeDir, sizeof(exeDir));
    ZeroMemory(scriptPath, sizeof(scriptPath));
    ZeroMemory(pythonPath, sizeof(pythonPath));

    if (!GetModuleFileNameW(NULL, exePath, MAX_PATH)) {
        return 1;
    }

    for (i = 0; exePath[i] != L'\0'; i++) {
        if (exePath[i] == L'/') exePath[i] = L'\\';
    }

    wcsncpy(exeDir, exePath, MAX_PATH);
    lastSlash = wcsrchr(exeDir, L'\\');
    if (lastSlash) {
        *lastSlash = L'\0';
    }

    // Locate control_panel.py
    PathCombineW(scriptPath, exeDir, L"control_panel.py");
    if (!FileExists(scriptPath)) {
        PathCombineW(scriptPath, exeDir, L"app\\control_panel.py");
        if (!FileExists(scriptPath)) {
            MessageBoxW(NULL,
                L"AquaMusic Control Panel script (control_panel.py) was not found in the application directory.",
                L"AquaMusic Error", MB_ICONERROR);
            return 1;
        }
    }

    // 1. Check local embedded python first (if present)
    PathCombineW(pythonPath, exeDir, L"python\\pythonw.exe");
    if (!FileExists(pythonPath)) {
        PathCombineW(pythonPath, exeDir, L"pythonw.exe");
    }
    if (!FileExists(pythonPath)) {
        PathCombineW(pythonPath, exeDir, L"python\\python.exe");
    }
    if (!FileExists(pythonPath)) {
        PathCombineW(pythonPath, exeDir, L"python.exe");
    }

    // 2. Search Windows PATH for pythonw.exe or python.exe
    if (!FileExists(pythonPath)) {
        wchar_t found[MAX_PATH];
        if (SearchPathW(NULL, L"pythonw.exe", NULL, MAX_PATH, found, NULL)) {
            wcsncpy(pythonPath, found, MAX_PATH);
        } else if (SearchPathW(NULL, L"python.exe", NULL, MAX_PATH, found, NULL)) {
            wcsncpy(pythonPath, found, MAX_PATH);
        }
    }

    // 3. Check common Windows installation paths
    if (!FileExists(pythonPath)) {
        const wchar_t* commonPaths[] = {
            L"C:\\Python313\\pythonw.exe",
            L"C:\\Python312\\pythonw.exe",
            L"C:\\Python311\\pythonw.exe",
            L"C:\\Python310\\pythonw.exe",
            L"C:\\Program Files\\Python312\\pythonw.exe",
            L"C:\\Program Files\\Python311\\pythonw.exe",
            L"C:\\Program Files\\Python310\\pythonw.exe",
        };
        for (size_t f = 0; f < sizeof(commonPaths) / sizeof(commonPaths[0]); f++) {
            if (FileExists(commonPaths[f])) {
                wcsncpy(pythonPath, commonPaths[f], MAX_PATH);
                break;
            }
        }
    }

    // Check %LOCALAPPDATA%\Programs\Python
    if (!FileExists(pythonPath)) {
        wchar_t userPy[MAX_PATH];
        ExpandEnvironmentStringsW(L"%LOCALAPPDATA%\\Programs\\Python\\Python312\\pythonw.exe", userPy, MAX_PATH);
        if (FileExists(userPy)) {
            wcsncpy(pythonPath, userPy, MAX_PATH);
        } else {
            ExpandEnvironmentStringsW(L"%LOCALAPPDATA%\\Programs\\Python\\Python311\\pythonw.exe", userPy, MAX_PATH);
            if (FileExists(userPy)) {
                wcsncpy(pythonPath, userPy, MAX_PATH);
            }
        }
    }

    // If still not found, prompt user
    if (!FileExists(pythonPath)) {
        int choice = MessageBoxW(NULL,
            L"Python 3 was not detected on your system.\n\n"
            L"AquaMusic requires Python 3 with requirements installed.\n"
            L"Would you like to open the official Python download page now?",
            L"Python Required - AquaMusic", MB_ICONWARNING | MB_YESNO);
        if (choice == IDYES) {
            ShellExecuteW(NULL, L"open", L"https://www.python.org/downloads/", NULL, NULL, SW_SHOWNORMAL);
        }
        return 1;
    }

    // Build command line: "pythonw.exe" "control_panel.py"
    wcscpy(cmdLine, L"\"");
    wcscat(cmdLine, pythonPath);
    wcscat(cmdLine, L"\" \"");
    wcscat(cmdLine, scriptPath);
    wcscat(cmdLine, L"\"");

    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    if (!CreateProcessW(
        pythonPath,
        cmdLine,
        NULL,
        NULL,
        FALSE,
        CREATE_NO_WINDOW,
        NULL,
        exeDir,
        &si,
        &pi
    )) {
        DWORD err = GetLastError();
        wchar_t errMsg[512];
        swprintf(errMsg, 512, L"Failed to start AquaMusic Control Panel (Error %lu).", err);
        MessageBoxW(NULL, errMsg, L"AquaMusic Error", MB_ICONERROR);
        return 1;
    }

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    return 0;
}
