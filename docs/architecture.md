# Architecture (v1)

Natalie Bot v1 does one thing: upload a video, get it back as a 9:16 reel with music. The phone never streams video through the API. It uploads to and downloads from S3 with presigned URLs, and only the processing Lambda touches the video.

```mermaid
flowchart LR
    app["iPhone app<br/>React Native (Expo)<br/>EAS Build, TestFlight"]

    subgraph aws["AWS (Serverless, TypeScript)"]
        cognito["Amazon Cognito<br/>Sign in with Apple"]
        api["API Gateway + Lambda<br/>presigned URLs, job status"]
        s3[("Amazon S3<br/>uploaded videos, finished reels")]
        proc["Processing Lambda<br/>FFmpeg layer<br/>crop to 9:16, add a track"]
        db[("Postgres (RDS)<br/>users, jobs, tracks")]
    end

    app -->|sign in| cognito
    app -->|"1, 4"| api
    app <-->|"1 upload / 4 download"| s3
    s3 -->|"2 trigger"| proc
    proc -->|"2 result"| s3
    proc <-->|"3 job done / reads tracks"| db
    api -->|"4 status"| db

    classDef main stroke-width:2px
    class proc main
```

## The flow

The numbers on the arrows match these steps.

1. The app asks the API (API Gateway + Lambda) for a presigned S3 URL and uploads the video directly to S3.
2. The upload triggers the processing Lambda, which has an FFmpeg layer. It crops the video to 9:16 (1080 x 1920), picks a track from the library, replaces the audio with it, and writes the result to S3.
3. The Lambda marks the job done in Postgres (RDS), which has tables for users, jobs and tracks.
4. The app polls the API for job status, then downloads the finished reel through a presigned URL.

Auth is Cognito with Sign in with Apple. Builds ship through EAS Build and Submit and are tested in TestFlight.

## Limits that shape the design

- Uploads are capped at 90 seconds so rendering stays well inside Lambda's 15-minute limit. If renders outgrow it, rendering moves to Fargate.
- v1 replaces the original audio instead of mixing music under it.
- Posting directly to Instagram is out of scope for v1. Users share through the iOS share sheet.
