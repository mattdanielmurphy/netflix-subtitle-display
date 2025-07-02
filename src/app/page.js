"use client"; // This is a client component

import React, { useCallback, useEffect, useRef, useState } from 'react';

import Head from 'next/head';
import styles from './page.module.css';

export default function SubtitleLogPage() {
    const logContainerRef = useRef(null);
    const statusMessageRef = useRef(null);
    const playBtnRef = useRef(null);
    const pauseBtnRef = useRef(null);
    const back10BtnRef = useRef(null);
    const forward10BtnRef = useRef(null);
    const toggleOrderBtnRef = useRef(null);

    const [subtitleLog, setSubtitleLog] = useState([]);
    const [latestEntryId, setLatestEntryId] = useState(null);
    const [currentEpisodeId, setCurrentEpisodeId] = useState(null);
    const [isReverseOrder, setIsReverseOrder] = useState(() => {
        return typeof window !== 'undefined' ? localStorage.getItem('subtitleOrder') !== 'chronological' : true;
    });
    const socketRef = useRef(null);

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
                console.error("[diaLOG] Error saving to localStorage:", e);
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
                console.error("[diaLOG] Error parsing stored diaLOG:", e);
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
            newEntry.className = styles.logEntry;
            if (data.id === latestEntryId) {
                newEntry.classList.add(styles.latest);
            }
            newEntry.dataset.timeInSeconds = data.timeInSeconds;

            const timeSpan = document.createElement("span");
            timeSpan.className = styles.timestamp;
            timeSpan.textContent = `[${data.time}]`;

            const textSpan = document.createElement("span");
            textSpan.className = styles.subtitleText;
            textSpan.textContent = data.text;

            newEntry.appendChild(timeSpan);
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
    }, [subtitleLog, isReverseOrder, latestEntryId]);

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
                    console.log(`[Subtitle Display] Received episodeId: ${data.episodeId}. Current episodeId: ${currentEpisodeId}`);
                    localStorage.setItem("currentNetflixEpisodeId", data.episodeId);
                    if (currentEpisodeId !== data.episodeId) {
                        console.log(`[Subtitle Display] Episode ID changed from ${currentEpisodeId} to ${data.episodeId}. Clearing log.`);
                        if (currentEpisodeId) {
                            localStorage.removeItem(`diaLOG_${currentEpisodeId}`);
                        }
                        setCurrentEpisodeId(data.episodeId);
                        setSubtitleLog([]);
                        console.log(`[Subtitle Display] Log cleared and re-rendered for new episode.`);
                    }
                    loadLog(data.episodeId);
                    console.log(`[Subtitle Display] Loaded log for episode: ${data.episodeId}`);
                }
            } catch (error) {
                console.error("Failed to parse incoming data:", event.data, error);
            }
        };

        return () => {
            if (socketRef.current) {
                socketRef.current.onmessage = null;
            }
        };
    }, [currentEpisodeId, loadLog, saveLog]);

    useEffect(() => {
        if (!socketRef.current) return;

        const identifyClient = () => {
            if (socketRef.current.readyState === WebSocket.OPEN) {
                socketRef.current.send(JSON.stringify({ type: "identify", client: "display", episodeId: currentEpisodeId }));
            }
        };

        if (socketRef.current.readyState === WebSocket.OPEN) {
            identifyClient();
        } else {
            socketRef.current.addEventListener('open', identifyClient);
        }

        return () => {
            if (socketRef.current) {
                socketRef.current.removeEventListener('open', identifyClient);
            }
        };
    }, [currentEpisodeId]);

    const sendSocketMessage = useCallback((type, payload = {}) => {
        console.log(`[Subtitle Page] Sending message: ${type}`, payload);
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            socketRef.current.send(JSON.stringify({ type, ...payload }));
        } else {
            console.warn(`[Subtitle Page] WebSocket not open. Cannot send message: ${type}`);
        }
    }, []);

    useEffect(() => {
        const handleKeyDown = (e) => {
            console.log(`[Subtitle Page] Keydown event detected: ${e.code}`);
            if (e.code === 'Space') {
                e.preventDefault();
                console.log("[Subtitle Page] Spacebar pressed, calling sendSocketMessage with 'togglePlay'");
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
        setIsReverseOrder(prev => {
            const newOrder = !prev;
            localStorage.setItem('subtitleOrder', newOrder ? 'reverse' : 'chronological');
            return newOrder;
        });
    };

    const handleLogEntryClick = (e) => {
        const entry = e.target.closest(`.${styles.logEntry}`);
        if (entry && entry.dataset.timeInSeconds) {
            const timeInSeconds = parseFloat(entry.dataset.timeInSeconds);
            if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                socketRef.current.send(JSON.stringify({ type: "seek", timeInSeconds: timeInSeconds }));
            }
        }
    };

    return (
        <div className={styles.body}>
            <Head>
                <title>Subtitle Log</title>
            </Head>
            <div id="status-message" ref={statusMessageRef} className={styles.statusMessage}>Connecting...</div>
            <div id="controls" className={styles.controls}>
                <button id="play-btn" ref={playBtnRef} onClick={() => sendSocketMessage("play")}>▶</button>
                <button id="pause-btn" ref={pauseBtnRef} onClick={() => sendSocketMessage("pause")}>⏸</button>
                <button id="back-10-btn" ref={back10BtnRef} onClick={() => sendSocketMessage("seekRelative", { offsetInSeconds: -10 })}>⏪</button>
                <button id="forward-10-btn" ref={forward10BtnRef} onClick={() => sendSocketMessage("seekRelative", { offsetInSeconds: 10 })}>⏩</button>
                <button id="toggle-order-btn" ref={toggleOrderBtnRef} onClick={handleToggleOrder}>Sort: Oldest First</button>
            </div>
            <div id="log-container" ref={logContainerRef} onClick={handleLogEntryClick} className={styles.logContainer}></div>
        </div>
    );
}