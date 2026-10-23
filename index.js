const API_BASE_URL = `https://whatsup-private-messaging.adam-towfek.workers.dev`;
let currentSessionUser = null;

function redirectToLogin() {
    window.location.replace("login.html");
}

async function readResponseBody(response) {
    const text = await response.text();

    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch {
        return { message: text };
    }
}

function getApiError(body, fallback) {
    if (typeof body === "string" && body.trim()) {
        return body;
    }

    if (body && typeof body === "object") {
        const message = body.error?.message || body.error || body.message;
        if (typeof message === "string" && message.trim()) {
            return message;
        }
    }

    return fallback;
}

async function loadSession() {
    const response = await fetch(`${API_BASE_URL}/me`, {
        method: "GET",
        credentials: "include",
    });

    if (response.status === 401) {
        currentSessionUser = null;
        if (document.body.dataset.page !== "login") {
            redirectToLogin();
        }
        return false;
    }

    if (!response.ok) {
        const body = await readResponseBody(response);
        throw new Error(getApiError(body, "Unable to verify your session."));
    }

    const session = await readResponseBody(response);
    currentSessionUser = session?.user || session;
    return true;
}

function showMessage(message, kind = "error") {
    const formMessage = document.querySelector("#formMessage");
    if (!formMessage) {
        return;
    }

    formMessage.textContent = message;
    formMessage.dataset.kind = kind;
}

function showBoardStatus(message, kind = "error") {
    showMessage(message, kind);
}

function formatMessageTime(timestamp) {
    const numericTimestamp = Number(timestamp);
    const milliseconds = Math.abs(numericTimestamp) < 1e12
        ? numericTimestamp * 1000
        : numericTimestamp;
    const date = new Date(milliseconds);

    if (!Number.isFinite(milliseconds) || Number.isNaN(date.getTime())) {
        return "";
    }

    const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayDifference = Math.round((today - messageDay) / 86400000);

    if (dayDifference === 0) {
        return time;
    }
    if (dayDifference === 1) {
        return `Yesterday ${time}`;
    }
    return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

function renderMessages(messages) {
    const list = document.querySelector("#messageList");
    const wasAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
    const previousScrollTop = list.scrollTop;
    const fragment = document.createDocumentFragment();

    if (messages.length === 0) {
        const emptyState = document.createElement("p");
        emptyState.className = "board-empty";
        emptyState.textContent = "No messages yet. Be the first person to post!";
        fragment.append(emptyState);
    } else {
        messages.forEach((message) => {
            const isOwnMessage = currentSessionUser?.id !== undefined
                && currentSessionUser?.id !== null
                && String(message.senderId) === String(currentSessionUser.id);
            const row = document.createElement("article");
            row.className = isOwnMessage ? "message-row message-own" : "message-row";

            const meta = document.createElement("p");
            meta.className = "message-meta";
            const username = document.createElement("strong");
            username.textContent = isOwnMessage ? "You" : (message.username || "Unknown");
            const separator = document.createTextNode(" • ");
            const time = document.createElement("time");
            const timestamp = message.timestamp ?? message.createdAt ?? message.created_at;
            time.textContent = formatMessageTime(timestamp);
            if (timestamp !== undefined && timestamp !== null) {
                const numericTimestamp = Number(timestamp);
                const milliseconds = Math.abs(numericTimestamp) < 1e12
                    ? numericTimestamp * 1000
                    : numericTimestamp;
                const date = new Date(milliseconds);
                if (!Number.isNaN(date.getTime())) {
                    time.dateTime = date.toISOString();
                }
            }

            const content = document.createElement("p");
            content.className = "message-content";
            content.textContent = message.content ?? "";

            meta.append(username, separator, time);
            row.append(meta, content);
            fragment.append(row);
        });
    }

    list.replaceChildren(fragment);
    if (wasAtBottom) {
        list.scrollTop = list.scrollHeight;
    } else {
        list.scrollTop = previousScrollTop;
    }
}

let isLoadingMessages = false;

async function loadMessages() {
    if (isLoadingMessages) {
        return;
    }
    isLoadingMessages = true;

    try {
        const response = await fetch(`${API_BASE_URL}/msg`, {
            method: "GET",
            credentials: "include",
        });
        const body = await readResponseBody(response);

        if (response.status === 401) {
            redirectToLogin();
            return;
        }
        if (response.status === 403) {
            showBoardStatus("Please verify your email before sending messages.");
            return;
        }
        if (!response.ok) {
            throw new Error(getApiError(body, "Unable to load messages."));
        }

        const messages = Array.isArray(body) ? body : body?.messages;
        if (!Array.isArray(messages)) {
            throw new Error("The message response has an unexpected format.");
        }

        renderMessages(messages);
        showBoardStatus("");
    } catch (error) {
        showBoardStatus(error.message || "Unable to load messages.");
    } finally {
        isLoadingMessages = false;
    }
}

async function sendMessage(event) {
    event.preventDefault();
    const input = document.querySelector("#messageInput");
    const content = input.value.trim();
    if (!content || !currentSessionUser?.verified) {
        return;
    }

    const sendButton = document.querySelector("#sendButton");
    sendButton.disabled = true;
    showBoardStatus("");

    try {
        const response = await fetch(`${API_BASE_URL}/msg`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ content }),
        });
        const body = await readResponseBody(response);

        if (response.status === 401) {
            redirectToLogin();
            return;
        }
        if (response.status === 403) {
            showBoardStatus("Please verify your email before sending messages.");
            return;
        }
        if (!response.ok) {
            throw new Error(getApiError(body, "Unable to send message."));
        }

        input.value = "";
        await loadMessages();
    } catch (error) {
        showBoardStatus(error.message || "Unable to send message.");
    } finally {
        sendButton.disabled = !currentSessionUser?.verified;
    }
}

async function handleVerificationIfNeeded(promptUser = true) {
    let accountUser = currentSessionUser;
    if (!accountUser) {
        const accountResponse = await fetch(`${API_BASE_URL}/me`, {
            method: "GET",
            credentials: "include",
        });
        const account = await readResponseBody(accountResponse);

        if (!accountResponse.ok) {
            throw new Error(getApiError(account, "Unable to check your email verification status."));
        }

        accountUser = account?.user || account;
        currentSessionUser = accountUser;
    }

    if (accountUser?.verified !== false && accountUser?.verified !== 0) {
        return false;
    }

    let shouldSendEmail = true;
    if (promptUser) {
        const dialog = document.querySelector("#verificationDialog");
        if (!dialog) {
            throw new Error("The email verification prompt is unavailable.");
        }

        shouldSendEmail = await new Promise((resolve) => {
            const handleClose = () => {
                dialog.removeEventListener("close", handleClose);
                resolve(dialog.returnValue === "send");
            };

            dialog.addEventListener("close", handleClose);
            dialog.showModal();
        });
    }

    if (!shouldSendEmail) {
        return false;
    }

    const sendResponse = await fetch(`${API_BASE_URL}/verification/send`, {
        method: "POST",
        credentials: "include",
    });
    const sendBody = await readResponseBody(sendResponse);

    if (!sendResponse.ok) {
        throw new Error(getApiError(sendBody, "Unable to send the verification email."));
    }

    showMessage(
        sendBody?.message || "Verification email sent. Please check your inbox.",
        "success"
    );
    return true;
}

function setFormLoading(form, isLoading, buttonText) {
    const button = form.querySelector("#submitButton");
    if (!button) {
        return;
    }

    if (isLoading) {
        button.dataset.originalText = button.textContent;
        button.textContent = buttonText;
        button.disabled = true;
    } else {
        button.textContent = button.dataset.originalText || buttonText;
        button.disabled = false;
    }
}

function validateRegistrationForm() {
    const emailInput = document.querySelector("#email");
    const usernameInput = document.querySelector("#username");
    const passwordInput = document.querySelector("#password");
    const confirmPasswordInput = document.querySelector("#confirmPassword");

    const usernameIsValid = usernameInput.value === ""
        || /^[A-Za-z0-9_]{3,24}$/.test(usernameInput.value);
    const passwordCharacterCount = [...passwordInput.value].length;
    const passwordByteCount = new TextEncoder().encode(passwordInput.value).length;

    emailInput.setCustomValidity(
        emailInput.value !== "" && emailInput.validity.typeMismatch
            ? "Enter a valid email address."
            : ""
    );
    usernameInput.setCustomValidity(
        usernameIsValid ? "" : "Use 3–24 characters: letters, numbers, or underscores."
    );
    passwordInput.setCustomValidity(
        passwordInput.value === ""
            || (passwordCharacterCount >= 12 && passwordByteCount <= 1024)
            ? ""
            : "Password must be at least 12 characters and no more than 1,024 UTF-8 bytes."
    );
    confirmPasswordInput.setCustomValidity(
        confirmPasswordInput.value === "" || confirmPasswordInput.value === passwordInput.value
            ? ""
            : "Passwords do not match."
    );
}

function getSessionUsername(session) {
    const candidates = [
        session?.username,
        session?.user?.username,
        session?.data?.username,
        session?.data?.user?.username,
    ];

    return candidates.find((username) => typeof username === "string" && username.length > 0);
}

function setupPasswordToggles() {
    document.querySelectorAll(".toggle-password").forEach((button) => {
        button.addEventListener("click", () => {
            const input = document.getElementById(button.getAttribute("aria-controls"));
            const showPassword = input.type === "password";

            input.type = showPassword ? "text" : "password";
            button.textContent = showPassword ? "Hide" : "Show";
            button.setAttribute("aria-pressed", String(showPassword));
        });
    });
}

async function setupPage() {
    setupPasswordToggles();

    const page = document.body.dataset.page;
    const sendVerificationButton = document.querySelector("#sendVerificationButton");
    if (sendVerificationButton) {
        sendVerificationButton.addEventListener("click", () => {
            console.log("[verification] Send Verification Email button clicked");
        });
    }

    if (page === "login") {
        try {
            if (await loadSession()) {
                window.location.replace("index.html");
                return;
            }
        } catch (error) {
            showMessage(`Could not check your session: ${error.message}`);
        }
    }

    if (page === "board") {
        try {
            if (!(await loadSession())) {
                return;
            }

            document.querySelector("#loggedInUsername").textContent =
                getSessionUsername(currentSessionUser) || "Unknown";
            const isVerified = Boolean(currentSessionUser?.verified);
            document.querySelector("#verificationStatus").textContent = isVerified
                ? "Verified ✅"
                : "Unverified ⚠️";
            document.querySelector("#messageInput").disabled = !isVerified;
            document.querySelector("#sendButton").disabled = !isVerified;
            document.querySelector("#verificationNotice").hidden = isVerified;

            document.querySelector("#messageForm").addEventListener("submit", sendMessage);
            document.querySelector("#messageInput").addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    document.querySelector("#messageForm").requestSubmit();
                }
            });

            try {
                await handleVerificationIfNeeded();
            } catch (error) {
                showBoardStatus(error.message || "Unable to send the verification email.");
            }

            await loadMessages();
            window.setInterval(loadMessages, 5000);
        } catch (error) {
            showBoardStatus(`Could not verify your session: ${error.message}`);
        }

        document.querySelector("#logoutButton").addEventListener("click", async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            showMessage("");

            try {
                const response = await fetch(`${API_BASE_URL}/logout`, {
                    method: "POST",
                    credentials: "include",
                });
                const body = await readResponseBody(response);

                if (response.status === 401) {
                    redirectToLogin();
                    return;
                }
                if (!response.ok) {
                    throw new Error(getApiError(body, "Logout failed. Please try again."));
                }

                window.location.replace("login.html");
            } catch (error) {
                showBoardStatus(error.message || "Unable to log out. Please try again.");
                button.disabled = false;
            }
        });
    }

    const registrationForm = document.querySelector("#registrationForm");
    if (registrationForm) {
        const emailInput = document.querySelector("#email");
        const usernameInput = document.querySelector("#username");
        const passwordInput = document.querySelector("#password");
        const confirmPasswordInput = document.querySelector("#confirmPassword");

        [emailInput, usernameInput, passwordInput, confirmPasswordInput].forEach((input) => {
            input.addEventListener("input", validateRegistrationForm);
        });

        registrationForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            showMessage("");
            validateRegistrationForm();

            if (!registrationForm.reportValidity()) {
                return;
            }

            setFormLoading(registrationForm, true, "Creating account…");

            try {
                const credentials = {
                    username: usernameInput.value,
                    password: passwordInput.value,
                    email: emailInput.value,
                };
                const registerResponse = await fetch(`${API_BASE_URL}/register`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify(credentials),
                });
                const registerBody = await readResponseBody(registerResponse);

                if (!registerResponse.ok) {
                    throw new Error(getApiError(registerBody, "Registration failed."));
                }

                const loginResponse = await fetch(`${API_BASE_URL}/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify(credentials),
                });
                const loginBody = await readResponseBody(loginResponse);

                if (!loginResponse.ok) {
                    throw new Error(
                        `Account created, but automatic login failed: ${getApiError(loginBody, "Please log in.")}`
                    );
                }

                await handleVerificationIfNeeded();
                window.location.replace("index.html");
            } catch (error) {
                showMessage(error.message || "Registration failed. Please try again.");
            } finally {
                setFormLoading(registrationForm, false, "Create account");
            }
        });
    }

    const loginForm = document.querySelector("#loginForm");
    if (loginForm) {
        loginForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            showMessage("");

            if (!loginForm.reportValidity()) {
                return;
            }

            setFormLoading(loginForm, true, "Logging in…");

            try {
                const credentials = {
                    username: document.querySelector("#username").value,
                    password: document.querySelector("#password").value,
                };
                const response = await fetch(`${API_BASE_URL}/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify(credentials),
                });
                const body = await readResponseBody(response);

                if (!response.ok) {
                    throw new Error(getApiError(body, "Login failed."));
                }

                await handleVerificationIfNeeded(false);
                window.location.replace("index.html");
            } catch (error) {
                showMessage(error.message || "Login failed. Please try again.");
            } finally {
                setFormLoading(loginForm, false, "Login");
            }
        });
    }
}

setupPage();
