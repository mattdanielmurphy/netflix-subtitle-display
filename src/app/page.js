"use client"; // This is a client component

import React, { useCallback, useEffect, useRef, useState } from 'react';

import Head from 'next/head';
import styles from './page.module.css';

// Helper to get current wall-clock time as a string
function logWithTime(...args) {
    console.log(`[${new Date().toISOString()}]`, ...args);
}

export default function SubtitleLogPage() {
    const logContainerRef = useRef(null);
    const statusMessageRef = useRef(null);
    const back10BtnRef = useRef(null);
    const forward10BtnRef = useRef(null);
    const toggleOrderBtnRef = useRef(null);

    const [subtitleLog, setSubtitleLog] = useState([]);
    const [latestEntryId, setLatestEntryId] = useState(null);
    const [currentEpisodeId, setCurrentEpisodeId] = useState(null);
    const [isReverseOrder, setIsReverseOrder] = useState(() => {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem('subtitleOrder');
            return stored !== 'chronological';
        }
        return true;
    });
    const socketRef = useRef(null);
    const [isShowTimestamps, setIsShowTimestamps] = useState(() => {
        if (typeof window !== 'undefined') {
            const stored = localStorage.getItem('showTimestamps');
            return stored === null ? false : stored === 'true';
        }
        return false;
    });

    const episodeIdDebounceRef = useRef({ timer: null, pending: null });

    const updateButtonText = useCallback(() => {
        if (toggleOrderBtnRef.current) {
            toggleOrderBtnRef.current.textContent = isReverseOrder ? 'Sort: Newest First' : 'Sort: Oldest First';
        }
    }, [isReverseOrder]);

    const saveLog = useCallback((logToSave, episodeId) => {
        if (episodeId && logToSave.length > 0) {
            try {
                localStorage.setItem(`diaLOG_${episodeId}`, JSON.stringify(logToSave));
            } catch (e) {
                logWithTime("[diaLOG] Error saving to localStorage:", e);
            }
        } else if (episodeId) {
            localStorage.removeItem(`diaLOG_${episodeId}`);
        }
    }, []);

    const loadLog = useCallback((episodeId) => {
        if (typeof window === 'undefined') return;
        const storedLog = localStorage.getItem(`diaLOG_${episodeId}`);
        if (storedLog) {
            try {
                setSubtitleLog(JSON.parse(storedLog));
            } catch (e) {
                logWithTime("[diaLOG] Error parsing stored diaLOG:", e);
                setSubtitleLog([]);
            }
        } else {
            setSubtitleLog([]);
        }
    }, []);

    const renderLog = useCallback(() => {
        if (!logContainerRef.current) return;

        const logContainer = logContainerRef.current;
        const scrollPosition = logContainer.scrollTop;
        const scrollHeightBefore = logContainer.scrollHeight;
        const isAtTop = logContainer.scrollTop < 50;
        const isScrolledToBottom = logContainer.scrollHeight - logContainer.scrollTop <= logContainer.clientHeight + 1;

        let sortedLog = [...subtitleLog];
        if (isReverseOrder) {
            sortedLog.sort((a, b) => b.timeInSeconds - a.timeInSeconds);
        } else {
            sortedLog.sort((a, b) => a.timeInSeconds - b.timeInSeconds);
        }

        logContainer.innerHTML = "";

        sortedLog.forEach((data) => {
            const newEntry = document.createElement("div");
            newEntry.className = styles.logEntry + (data.id === latestEntryId ? ` ${styles.latest}` : "");
            newEntry.dataset.timeInSeconds = data.timeInSeconds;
            if (isShowTimestamps) {
                newEntry.setAttribute('data-timestamp', `[${data.time}]`);
            } else {
                newEntry.removeAttribute('data-timestamp');
            }
            // Create the seek arrow button
            const arrowBtn = document.createElement("button");
            arrowBtn.className = styles.seekArrow;
            arrowBtn.setAttribute('tabindex', '0');
            arrowBtn.setAttribute('aria-label', 'Seek to this line');
            arrowBtn.innerHTML = '▶';
            arrowBtn.dataset.timeInSeconds = data.timeInSeconds;
            // Prevent click from bubbling to parent
            arrowBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                    socketRef.current.send(JSON.stringify({ type: "seek", timeInSeconds: data.timeInSeconds }));
                }
            });
            newEntry.appendChild(arrowBtn);
            // Subtitle text
            const textSpan = document.createElement("span");
            textSpan.className = styles.subtitleText;
            textSpan.textContent = data.text;
            newEntry.appendChild(textSpan);
            logContainer.appendChild(newEntry);
        });

        if (isReverseOrder) {
            const scrollHeightAfter = logContainer.scrollHeight;
            const heightDifference = scrollHeightAfter - scrollHeightBefore;
            if (!isAtTop && heightDifference > 0) {
                logContainer.scrollTop = scrollPosition + heightDifference;
            }
        } else {
            const latestElement = logContainer.querySelector(`.${styles.latest}`);
            if (latestElement && isScrolledToBottom) {
                latestElement.scrollIntoView({ behavior: "auto", block: "center" });
            }
        }
    }, [subtitleLog, isReverseOrder, latestEntryId, isShowTimestamps]);

    useEffect(() => {
        renderLog();
    }, [renderLog]);

    useEffect(() => {
        updateButtonText();
    }, [updateButtonText]);

    useEffect(() => {
        let reconnectAttempts = 0;
        const MAX_RECONNECT_ATTEMPTS = 10;
        const RECONNECT_INTERVAL_MS = 5000;

        const connectWebSocket = () => {
            if (socketRef.current && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)) {
                return;
            }

            if (statusMessageRef.current) {
                statusMessageRef.current.textContent = "Connecting...";
                statusMessageRef.current.style.display = "block";
            }
            
            const socket = new WebSocket("wss://netflix-websocket-server.onrender.com");
            socketRef.current = socket;

            socket.onopen = function () {
                if (statusMessageRef.current) {
                    statusMessageRef.current.textContent = "Connected";
                }
                reconnectAttempts = 0;
                
                // Send identification immediately after connection
                logWithTime("[Subtitle Display] Sending identification after reconnection");
                socket.send(JSON.stringify({ type: "identify", client: "display", episodeId: currentEpisodeId }));
                
                setTimeout(() => {
                    if (statusMessageRef.current) {
                        statusMessageRef.current.style.display = "none";
                    }
                }, 2000);
            };

            socket.onclose = function () {
                if (statusMessageRef.current) {
                    statusMessageRef.current.textContent = "Connection Lost. Reconnecting...";
                    statusMessageRef.current.style.display = "block";
                }
                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    setTimeout(connectWebSocket, RECONNECT_INTERVAL_MS);
                } else {
                    if (statusMessageRef.current) {
                        statusMessageRef.current.textContent = "Max reconnect attempts reached. Please refresh.";
                    }
                }
            };

            socket.onerror = function () {
                if (statusMessageRef.current) {
                    statusMessageRef.current.textContent = "Error connecting to server. Reconnecting...";
                    statusMessageRef.current.style.display = "block";
                }
            };
        };

        connectWebSocket();

        const storedEpisodeId = localStorage.getItem("currentNetflixEpisodeId");
        if (storedEpisodeId) {
            setCurrentEpisodeId(storedEpisodeId);
            loadLog(storedEpisodeId);
        }

        return () => {
            if (socketRef.current) {
                socketRef.current.onclose = null; // Prevent reconnects on unmount
                socketRef.current.close();
            }
        };
    }, [loadLog]);

    useEffect(() => {
        if (!socketRef.current) return;

        socketRef.current.onmessage = function (event) {
            try {
                const data = JSON.parse(event.data);

                if (data.type === "subtitle" && data.text && data.time) {
                    setSubtitleLog(prevLog => {
                        const existingEntry = prevLog.find(
                            (entry) => entry.text === data.text && Math.abs(entry.timeInSeconds - data.timeInSeconds) < 2
                        );

                        if (existingEntry) {
                            setLatestEntryId(existingEntry.id);
                            return prevLog;
                        } else {
                            const newEntry = { ...data, id: Date.now() };
                            setLatestEntryId(newEntry.id);
                            const updatedLog = [...prevLog, newEntry];
                            saveLog(updatedLog, currentEpisodeId);
                            return updatedLog;
                        }
                    });
                } else if (data.type === "episodeId") {
                    // Debounce logic for episodeId changes
                    if (episodeIdDebounceRef.current.timer) {
                        clearTimeout(episodeIdDebounceRef.current.timer);
                    }
                    episodeIdDebounceRef.current.pending = data.episodeId;
                    episodeIdDebounceRef.current.timer = setTimeout(() => {
                        const newEpisodeId = episodeIdDebounceRef.current.pending;
                        const currentId = currentEpisodeId;

                        logWithTime(`[Subtitle Display] (debounced) Received episodeId: "${newEpisodeId}" (type: ${typeof newEpisodeId}), current: "${currentId}"`);

                        // Only proceed if we have a valid episode ID
                        if (!newEpisodeId || newEpisodeId === 'null' || newEpisodeId === 'undefined') {
                            logWithTime(`[Subtitle Display] (debounced) Invalid episode ID received: ${newEpisodeId}. Ignoring.`);
                            return;
                        }

                        localStorage.setItem("currentNetflixEpisodeId", newEpisodeId);

                        // Use string comparison to avoid unnecessary log clearing
                        if (String(currentId) !== String(newEpisodeId) && currentId !== null && currentId !== undefined) {
                            logWithTime(`[Subtitle Display] (debounced) Episode ID changed from "${currentId}" to "${newEpisodeId}". Clearing log.`);
                            if (currentId) {
                                localStorage.removeItem(`diaLOG_${currentId}`);
                            }
                            setCurrentEpisodeId(newEpisodeId);
                            setSubtitleLog([]);
                            logWithTime(`[Subtitle Display] (debounced) Log cleared and loaded for episode: ${newEpisodeId}`);
                            loadLog(newEpisodeId);
                        } else if (currentId === newEpisodeId) {
                            logWithTime(`[Subtitle Display] (debounced) Same episode ID received: "${newEpisodeId}". No action needed.`);
                        } else if (currentId === null || currentId === undefined) {
                            logWithTime(`[Subtitle Display] (debounced) First episode ID received: "${newEpisodeId}". Loading log.`);
                            setCurrentEpisodeId(newEpisodeId);
                            loadLog(newEpisodeId);
                            logWithTime(`[Subtitle Display] (debounced) Loaded log for episode: ${newEpisodeId}`);
                        }
                        episodeIdDebounceRef.current.timer = null;
                        episodeIdDebounceRef.current.pending = null;
                    }, 300);
                }
            } catch (error) {
                logWithTime("Failed to parse incoming data:", event.data, error);
            }
        };

        return () => {
            if (socketRef.current) {
                socketRef.current.onmessage = null;
            }
            if (episodeIdDebounceRef.current.timer) {
                clearTimeout(episodeIdDebounceRef.current.timer);
                episodeIdDebounceRef.current.timer = null;
                episodeIdDebounceRef.current.pending = null;
            }
        };
    }, [currentEpisodeId, loadLog, saveLog]);

    useEffect(() => {
        if (!socketRef.current) return;

        const identifyClient = () => {
            if (socketRef.current.readyState === WebSocket.OPEN) {
                logWithTime("[Subtitle Display] Sending identification due to episodeId change");
                socketRef.current.send(JSON.stringify({ type: "identify", client: "display", episodeId: currentEpisodeId }));
            }
        };

        // Send identification whenever episodeId changes and socket is open
        if (socketRef.current.readyState === WebSocket.OPEN) {
            identifyClient();
        }

        return () => {
            // Cleanup not needed since we're not adding event listeners anymore
        };
    }, [currentEpisodeId]);

    const sendSocketMessage = useCallback((type, payload = {}) => {
        logWithTime(`[Subtitle Page] Sending message: ${type}`, payload);
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type, ...payload }));
        } else {
            logWithTime(`[Subtitle Page] WebSocket not open. Cannot send message: ${type}`);
        }
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            logWithTime(`[Subtitle Page] Keydown event detected: ${e.code}`);
            if (e.code === 'Space') {
                e.preventDefault();
                logWithTime("[Subtitle Page] Spacebar pressed, calling sendSocketMessage with 'togglePlay'");
                sendSocketMessage("togglePlay");
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                sendSocketMessage("seekRelative", { offsetInSeconds: -10 });
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                sendSocketMessage("seekRelative", { offsetInSeconds: 10 });
            }
        };

        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [sendSocketMessage]);

    const handleToggleOrder = () => {
        setIsReverseOrder(prev => !prev);
    };

    const handleLogEntryClick = () => {
        // Only handle clicks on the arrow, so do nothing here
    };

    useEffect(() => {
        localStorage.setItem('showTimestamps', isShowTimestamps);
    }, [isShowTimestamps]);

    useEffect(() => {
        localStorage.setItem('subtitleOrder', isReverseOrder ? 'reverse' : 'chronological');
    }, [isReverseOrder]);

    return (
        <div className={styles.body}>
            <Head>
                <title>Subtitle Log</title>
            </Head>
            <div id="status-message" ref={statusMessageRef} className={styles.statusMessage}>Connecting...</div>
            <div id="log-container" ref={logContainerRef} onClick={handleLogEntryClick} className={styles.logContainer}></div>
            <div id="controls" className={styles.controls}>
                <button
                    id="play-pause-btn"
                    onClick={() => {
                        sendSocketMessage("togglePlay");
                    }}
                >
                    {"▶ / ⏸"}
                </button>
                <button id="back-10-btn" ref={back10BtnRef} onClick={() => sendSocketMessage("seekRelative", { offsetInSeconds: -10 })}>
                    ⏮
                </button>
                <button id="forward-10-btn" ref={forward10BtnRef} onClick={() => sendSocketMessage("seekRelative", { offsetInSeconds: 10 })}>
                    ⏭
                </button>
                <button id="toggle-timestamps-btn" onClick={() => setIsShowTimestamps((prev) => !prev)}>
                    {isShowTimestamps ? "Hide Timestamps" : "Show Timestamps"}
                </button>
                <button id="toggle-order-btn" ref={toggleOrderBtnRef} onClick={handleToggleOrder}>Sort: Oldest First</button>
            </div>
        </div>
    );
}