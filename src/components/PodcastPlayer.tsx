
"use client"

import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Upload, Play, Pause, Rewind, FastForward, ListMusic, Music } from 'lucide-react';

const DB_NAME = 'PodcastProgressDB';
const DB_VERSION = 1;
const STORE_NAME = 'podcasts';

interface Podcast {
  id: number;
  name: string;
  file: File;
}

interface PodcastMetadata {
  id: number;
  name: string;
}

const db = {
  openDB: (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject("Error opening DB");
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
    });
  },
  addPodcast: async (file: File): Promise<PodcastMetadata> => {
    const dbInstance = await db.openDB();
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const podcast = { name: file.name, file: file };
      const request = store.add(podcast);
      request.onsuccess = () => resolve({ id: request.result as number, name: file.name });
      request.onerror = () => reject("Error adding podcast");
    });
  },
  getPodcasts: async (): Promise<PodcastMetadata[]> => {
    const dbInstance = await db.openDB();
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const podcasts = request.result.map((p: Podcast) => ({ id: p.id, name: p.name }));
        resolve(podcasts);
      };
      request.onerror = () => reject("Error getting podcasts");
    });
  },
  getPodcastFile: async (id: number): Promise<File | null> => {
    const dbInstance = await db.openDB();
    return new Promise((resolve, reject) => {
      const transaction = dbInstance.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result?.file || null);
      request.onerror = () => reject("Error getting podcast file");
    });
  }
};

const formatTime = (timeInSeconds: number): string => {
  if (isNaN(timeInSeconds) || timeInSeconds < 0) {
      return "00:00";
  }
  const minutes = Math.floor(timeInSeconds / 60);
  const seconds = Math.floor(timeInSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
};

export function PodcastPlayer() {
  const [podcasts, setPodcasts] = useState<PodcastMetadata[]>([]);
  const [currentPodcast, setCurrentPodcast] = useState<PodcastMetadata | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastSavedTimeRef = useRef<number>(0);
  
  const { toast } = useToast();

  useEffect(() => {
    db.getPodcasts()
      .then(setPodcasts)
      .catch(error => console.error(error))
      .finally(() => setIsLoading(false));
  }, []);

  const getSavedProgress = (podcastId: number) => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`podcast-progress-${podcastId}`);
      return saved ? JSON.parse(saved) : { currentTime: 0, duration: 0 };
    }
    return { currentTime: 0, duration: 0 };
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && (file.type.startsWith('audio/') || file.type === 'video/mp4')) {
      try {
        const newPodcast = await db.addPodcast(file);
        setPodcasts(prev => [...prev, newPodcast]);
        toast({ title: "Podcast imported!", description: `${file.name} has been added to your library.` });
      } catch (error) {
        toast({ variant: "destructive", title: "Import failed", description: "Could not save the podcast." });
      }
    } else {
      toast({ variant: "destructive", title: "Invalid file type", description: "Please select a valid audio file." });
    }
    if(fileInputRef.current) fileInputRef.current.value = "";
  };
  
  const handleSelectPodcast = useCallback(async (podcast: PodcastMetadata) => {
    if (currentPodcast?.id === podcast.id) {
        if (audioRef.current) {
            if (isPlaying) audioRef.current.pause();
            else audioRef.current.play();
        }
        return;
    }

    setCurrentPodcast(podcast);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    const file = await db.getPodcastFile(podcast.id);
    if (file && audioRef.current) {
      const url = URL.createObjectURL(file);
      audioRef.current.src = url;
      
      const { currentTime: savedTime } = getSavedProgress(podcast.id);
      
      const onLoadedMetadata = () => {
        if(audioRef.current) {
          audioRef.current.currentTime = savedTime;
          setDuration(audioRef.current.duration);
          audioRef.current.play();
        }
      };

      audioRef.current.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
      audioRef.current.load();
    }
  }, [currentPodcast, isPlaying]);

  const handlePlayPause = () => {
    if (!audioRef.current || !currentPodcast) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };
  
  const handleTimeUpdate = () => {
    if (!audioRef.current || !currentPodcast) return;
    const newCurrentTime = audioRef.current.currentTime;
    setCurrentTime(newCurrentTime);

    if (Math.abs(newCurrentTime - lastSavedTimeRef.current) > 5) {
      localStorage.setItem(`podcast-progress-${currentPodcast.id}`, JSON.stringify({ currentTime: newCurrentTime, duration: audioRef.current.duration }));
      lastSavedTimeRef.current = newCurrentTime;
      setPodcasts(prev => [...prev]);
    }
  };

  const handleSeek = (value: number[]) => {
    if (audioRef.current) {
      audioRef.current.currentTime = value[0];
      setCurrentTime(value[0]);
    }
  };

  const handleEnded = () => {
      setIsPlaying(false);
      if (currentPodcast) {
        localStorage.setItem(`podcast-progress-${currentPodcast.id}`, JSON.stringify({ currentTime: 0, duration: duration }));
      }
  }

  return (
    <div className="flex flex-col h-screen bg-background font-body">
      <header className="flex items-center justify-between p-4 border-b shrink-0 bg-card">
        <div className="flex items-center gap-3">
            <Music className="w-8 h-8 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight font-headline">Podcast Progress</h1>
        </div>
        <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Upload className="w-4 h-4 mr-2" />
          Import Podcast
        </Button>
        <Input type="file" ref={fileInputRef} onChange={handleFileChange} accept="audio/*,video/mp4" className="hidden" />
      </header>

      <div className="flex flex-col flex-grow md:flex-row md:overflow-hidden">
        <div className="md:w-1/3 border-r flex flex-col">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
                <ListMusic />
                Your Library
            </CardTitle>
          </CardHeader>
          <ScrollArea className="flex-grow p-4 pt-0">
              {isLoading ? (
                <p className="text-center text-muted-foreground">Loading podcasts...</p>
              ) : podcasts.length > 0 ? (
                <div className="space-y-2">
                {podcasts.map(podcast => {
                  const { currentTime, duration } = getSavedProgress(podcast.id);
                  return (
                    <Button
                      key={podcast.id}
                      variant={currentPodcast?.id === podcast.id ? "secondary" : "ghost"}
                      className="w-full h-auto p-3 text-left justify-between flex flex-col items-start"
                      onClick={() => handleSelectPodcast(podcast)}
                    >
                      <span className="mb-2 font-semibold">{podcast.name}</span>
                      {duration > 0 && (
                        <div className="w-full">
                          <Progress value={(currentTime / duration) * 100} className="h-1 mb-1 bg-accent/20 [&>div]:bg-accent" />
                          <span className="text-xs text-muted-foreground">{formatTime(currentTime)} / {formatTime(duration)}</span>
                        </div>
                      )}
                    </Button>
                  )
                })}
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-10">
                    <p>No podcasts yet.</p>
                    <p>Click "Import Podcast" to begin.</p>
                </div>
              )}
          </ScrollArea>
        </div>
        
        <div className="flex-grow flex items-center justify-center p-4">
        {!currentPodcast ? (
            <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 rounded-lg border-2 border-dashed">
                <h2 className="text-xl font-semibold text-muted-foreground mb-4">Select a podcast to play</h2>
                <Music className="w-24 h-24 text-muted-foreground/50"/>
            </div>
        ) : (
        <Card className="w-full max-w-2xl">
          <CardHeader className="text-center pb-4">
            <CardTitle className="font-headline text-2xl">{currentPodcast.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-8 pt-4">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground tabular-nums">{formatTime(currentTime)}</span>
              <Slider
                value={[currentTime]}
                max={duration}
                step={1}
                onValueChange={handleSeek}
                className="w-full"
                aria-label="Podcast progress"
              />
              <span className="text-sm text-muted-foreground tabular-nums">{formatTime(duration)}</span>
            </div>
            <div className="flex justify-center items-center gap-4">
              <Button variant="ghost" size="lg" onClick={() => handleSeek([Math.max(0, currentTime - 15)])} aria-label="Rewind 15 seconds">
                <Rewind className="w-8 h-8" />
              </Button>
              <Button size="lg" onClick={handlePlayPause} className="w-20 h-20 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg transition-transform active:scale-95" aria-label={isPlaying ? 'Pause' : 'Play'}>
                {isPlaying ? <Pause className="w-10 h-10 fill-current" /> : <Play className="w-10 h-10 fill-current ml-1" />}
              </Button>
              <Button variant="ghost" size="lg" onClick={() => handleSeek([Math.min(duration, currentTime + 30)])} aria-label="Fast-forward 30 seconds">
                <FastForward className="w-8 h-8" />
              </Button>
            </div>
          </CardContent>
        </Card>
        )}
        </div>
      </div>
      
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
        onEnded={handleEnded}
        className="hidden"
      />
    </div>
  );
}
